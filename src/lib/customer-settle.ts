// One settlement rule for a customer's Paystack payment, whichever of the webhook and the browser's verify
// callback arrives first. The server-side intent decides who and which plan; Paystack only says what arrived.
import type { PaymentIntent, PrismaClient } from '@prisma/client'
import { logAudit } from '@/lib/audit'
import { INTENT_PENDING, INTENT_REVIEW, REVIEW_ACTION, consumePaymentIntent, parseCoversKeys } from '@/lib/payment-intent'
import { inFlightKeys } from '@/lib/pay-ahead'
import { PlanClosedError, creditPlanBalance } from '@/lib/plan-credit'
import { creditRegistrationReward } from '@/lib/reward'
import { money } from '@/lib/wallet-guard'

export type SettleResult =
  | { kind: 'credited'; amount: number; planId: string; notBought: number }
  | { kind: 'already' }
  | { kind: 'review' }

type Input = {
  intent: PaymentIntent
  reference: string
  amountNaira: number
  currency?: string
  channel?: string
  /** Shown in the note and audit trail: which route settled it. */
  via: 'Paystack' | 'Paystack webhook'
}

const SYSTEM_ACTOR = { actorType: 'system', actorName: 'Paystack settlement' }

/** Money arrived that can't be credited. Nothing moves; the audit row is what staff work from. */
export async function sendToReview(client: PrismaClient, intent: PaymentIntent, reference: string, reason: string): Promise<SettleResult> {
  const flipped = await client.$transaction(async (tx) => {
    const res = await tx.paymentIntent.updateMany({ where: { ref: reference, status: INTENT_PENDING }, data: { status: INTENT_REVIEW } })
    if (res.count === 1) {
      await tx.auditLog.create({
        data: { action: REVIEW_ACTION, entity: 'PaymentIntent', entityId: intent.id, details: `Not credited, needs manual review: ${reason} — ref ${reference}`, ...SYSTEM_ACTOR },
      })
    }
    return res.count === 1
  })
  if (flipped) console.warn(`[paystack settle] needs manual review ref=${reference}`)
  return { kind: 'review' }
}

export async function settleIntentPayment(client: PrismaClient, input: Input): Promise<SettleResult> {
  const { intent, reference, currency, channel, via } = input
  if (intent.status === INTENT_REVIEW) return { kind: 'review' }
  if (intent.status !== INTENT_PENDING) return { kind: 'already' }

  const customerId = intent.customerId
  const customer = customerId ? await client.customer.findUnique({ where: { id: customerId } }) : null
  if (!customerId || !customer) return sendToReview(client, intent, reference, 'the customer on this payment no longer exists')

  // Never treat another currency as naira.
  if (currency && currency !== intent.currency) {
    return sendToReview(client, intent, reference, `paid in ${currency}, expected ${intent.currency}, amount ${input.amountNaira}`)
  }

  const plan = intent.planId ? await client.savingsPlan.findFirst({ where: { id: intent.planId, customerId } }) : null
  if (!plan) return sendToReview(client, intent, reference, `plan ${intent.planId ?? 'none'} is missing, amount ₦${input.amountNaira}`)

  const amount = money(input.amountNaira)
  // No usable amount says nothing about what arrived. Consuming the intent on it would strand the real payment.
  if (!(amount > 0)) return sendToReview(client, intent, reference, `Paystack reported no usable amount (${input.amountNaira}), expected ₦${intent.amount}`)
  const matches = amount === money(intent.amount)
  const wanted = parseCoversKeys(intent.coversKeys)
  const keys = matches ? wanted : []

  // Days the card has been charged for since this checkout opened aren't free, even with no coverage row.
  const charged = await client.autoDebitAttempt.findMany({
    where: { savingsPlanId: plan.id, status: { in: ['processing', 'success'] } },
    select: { cycleDate: true },
  })
  const chargedKeys = new Set(inFlightKeys(plan, charged))

  const priorSavings = await client.transaction.count({ where: { customerId, type: 'saving' } })

  let bought = 0
  try {
    await client.$transaction(async (tx) => {
      // Atomically consume the intent; a losing/replayed call must not credit.
      const consumed = await consumePaymentIntent(tx, reference, { customerId })
      if (!consumed) throw new Error('ALREADY_PROCESSED')
      await tx.transaction.create({
        data: {
          ref: reference,
          agentId: customer.agentId,
          customerId,
          planId: plan.id,
          type: 'saving',
          amount,
          method: 'Paystack',
          status: 'Done',
          note: `Customer self-pay via ${via} — ${channel ?? 'card'}`,
        },
      })
      await creditPlanBalance(tx, plan.id, amount)
      await tx.customerPayment.create({
        data: { ref: `PAY-${reference}`, customerId, planId: plan.id, amount, status: 'Done', channel: channel ?? 'card' },
      })

      // Only free days are written; the first payment to a day keeps it (unique savingsPlanId + coversKey).
      const lost: string[] = []
      for (const coversKey of keys) {
        if (chargedKeys.has(coversKey)) { lost.push(coversKey); continue }
        const row = await tx.planDayCoverage.upsert({
          where: { savingsPlanId_coversKey: { savingsPlanId: plan.id, coversKey } },
          create: { savingsPlanId: plan.id, coversKey, ref: reference },
          update: {},
        })
        if (row.ref === reference) bought++
        else lost.push(coversKey)
      }

      if (!matches) {
        await tx.auditLog.create({
          data: { action: 'payment_amount_mismatch', entity: 'Transaction', details: `Paid ₦${amount}, expected ₦${intent.amount}. Credited what arrived; bought no days — ref ${reference}`, ...SYSTEM_ACTOR },
        })
      }
      if (lost.length > 0) {
        await tx.auditLog.create({
          data: { action: 'payment_days_overlap', entity: 'Transaction', details: `Credited in full, but these days were already paid for: ${lost.join(', ')} — ref ${reference}`, ...SYSTEM_ACTOR },
        })
      }
    })
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'ALREADY_PROCESSED') return { kind: 'already' }
    if (e instanceof PlanClosedError) return sendToReview(client, intent, reference, `plan ${plan.id} is closed, amount ₦${amount}`)
    // The other route got there first with the same ref. If there's no such credit, this is a different failure.
    if ((e as { code?: unknown } | null)?.code === 'P2002' && await client.transaction.findUnique({ where: { ref: reference }, select: { id: true } })) {
      return { kind: 'already' }
    }
    throw e
  }

  logAudit({
    action: 'customer_paystack_payment',
    entity: 'Transaction',
    details: `${customer.firstName} ${customer.lastName} (${customer.customerId}) paid ₦${amount.toLocaleString()} via ${via} — ref ${reference}`,
    ...(via === 'Paystack'
      ? { actorType: 'customer', actorId: customer.id, actorName: `${customer.firstName} ${customer.lastName}` }
      : { actorType: 'system', actorName: 'Paystack Webhook' }),
  })
  if (priorSavings === 0) creditRegistrationReward(customer).catch(() => {})

  return { kind: 'credited', amount, planId: plan.id, notBought: wanted.length - bought }
}

/** How many of the days on this payment's intent it did not end up buying, for the customer's notice. */
export async function daysNotBought(client: PrismaClient, reference: string, customerId: string): Promise<{ count: number; weekly: boolean }> {
  const intent = await client.paymentIntent.findFirst({ where: { ref: reference, customerId } })
  const wanted = parseCoversKeys(intent?.coversKeys ?? null)
  if (!intent?.planId || wanted.length === 0) return { count: 0, weekly: false }
  const [bought, plan] = await Promise.all([
    client.planDayCoverage.count({ where: { savingsPlanId: intent.planId, ref: reference, coversKey: { in: wanted } } }),
    client.savingsPlan.findUnique({ where: { id: intent.planId }, select: { cadence: true } }),
  ])
  return { count: wanted.length - bought, weekly: plan?.cadence === 'weekly' }
}
