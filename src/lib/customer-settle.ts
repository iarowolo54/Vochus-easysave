// One settlement rule for a customer's Paystack payment, whichever of the webhook and the browser's verify
// callback arrives first. The server-side intent decides who and which plan; Paystack only says what arrived.
import type { PaymentIntent, Prisma, PrismaClient } from '@prisma/client'
import { logAudit } from '@/lib/audit'
import { INTENT_PENDING, INTENT_REVIEW, REVIEW_ACTION, consumePaymentIntent, parseCoversKeys, recordManualCredit, type ManualActor } from '@/lib/payment-intent'
import { inFlightKeys } from '@/lib/pay-ahead'
import { PlanClosedError, creditPlanBalance } from '@/lib/plan-credit'
import { creditRegistrationReward } from '@/lib/reward'
import { money } from '@/lib/wallet-guard'
import { depositFeeOps } from '@/lib/commission-ledger'
import { sendPaymentAlert } from '@/lib/payment-alert'
import { notifications, notify } from '@/lib/notifications'
import { alertEmailFor } from '@/lib/email-alerts'
import { HAND_CREDIT_NOTE, handReceiptSms, wantsHandReceiptSms } from '@/lib/hand-receipt'
import { sendSMS } from '@/lib/kudisms'
import { settleAjoTransfer } from '@/lib/ajo-settle'

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
  via: 'Paystack' | 'Paystack webhook' | 'Moniepoint transfer' | 'Staff by hand'
  /** Set when staff credit this by hand; recorded inside the credit transaction. */
  manual?: ManualActor
  /** Extra writes that must succeed or fail together with the credit. Throw to roll everything back. */
  inTx?: (tx: Prisma.TransactionClient) => Promise<void>
}

const SYSTEM_ACTOR = { actorType: 'system', actorName: 'Payment settlement' }

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
  // An Ajo round, not a plan: same matching and review rules, its own ledger.
  if (input.intent.ajoMemberId) return settleAjoTransfer(client, input)
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

  const priorSavings = await client.transaction.count({ where: { customerId, type: 'saving' } })

  let bought = 0
  try {
    await client.$transaction(async (tx) => {
      // Atomically consume the intent; a losing/replayed call must not credit.
      const consumed = await consumePaymentIntent(tx, reference, { customerId })
      if (!consumed) throw new Error('ALREADY_PROCESSED')
      if (input.manual) await recordManualCredit(tx, { ref: reference, amount, who: `customer ${customer.customerId}`, manual: input.manual })
      await input.inTx?.(tx)
      const fee = await depositFeeOps(tx, { planId: plan.id, agentId: customer.agentId, customerId: customerId, amount, ref: reference })
      await tx.transaction.create({
        data: {
          ref: reference,
          agentId: customer.agentId,
          customerId,
          planId: plan.id,
          type: 'saving',
          amount,
          method: via === 'Moniepoint transfer' || via === 'Staff by hand' ? 'Transfer' : 'Paystack',
          status: 'Done',
          feeTaken: fee,
          note: via === 'Staff by hand' ? HAND_CREDIT_NOTE : `Customer self-pay via ${via} — ${channel ?? 'card'}`,
        },
      })
      // notify: savingsReceived
      await creditPlanBalance(tx, plan.id, money(amount - fee))
      await notify(tx, notifications.savingsReceived({
        ref: reference, customerId, agentId: customer.agentId, customerName: `${customer.firstName} ${customer.lastName}`,
        planGoal: plan.goal, amount, fee, onlineTransfer: plan.source === 'self' && (via === 'Moniepoint transfer' || via === 'Staff by hand'),
      }))
      await tx.customerPayment.create({
        data: { ref: `PAY-${reference}`, customerId, planId: plan.id, amount, status: 'Done', channel: channel ?? 'card' },
      })

      // Days the card has been charged for since this checkout opened aren't free, even with no coverage row. Read here,
      // inside the write, so a charge starting just now is seen.
      const charged = await tx.autoDebitAttempt.findMany({
        where: { savingsPlanId: plan.id, status: { in: ['processing', 'success'] } },
        select: { cycleDate: true },
      })
      const chargedKeys = new Set(inFlightKeys(plan, charged))

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
      : { actorType: 'system', actorName: via === 'Moniepoint transfer' || via === 'Staff by hand' ? via : 'Paystack Webhook' }),
  })
  if (priorSavings === 0) creditRegistrationReward(customer).catch(() => {})
  // Best effort: the money is already credited, so a failed email or SMS must never change the result.
  const sms = wantsHandReceiptSms({ via, planSource: plan.source }) && customer.phone ? customer.phone : null
  client.savingsPlan.findUnique({ where: { id: plan.id }, select: { balance: true, goal: true } })
    .then(async p => {
      const balanceAfter = p?.balance ?? null
      await sendPaymentAlert({
        kind: 'saving', email: alertEmailFor(customer), name: customer.firstName, amount, reference,
        via, destination: p?.goal || 'your savings plan', balanceAfter,
      })
      // A cash customer whose transfer staff approved by hand gets one SMS receipt (most don't open the app or email).
      if (sms) {
        // sms: hand-approved deposit receipt, cash customers only (owner exception)
        const r = await sendSMS(sms, handReceiptSms({ name: customer.firstName, amount, goal: p?.goal ?? '', balanceAfter, reference }))
        if (!r.success) console.error('[hand-receipt] SMS not sent:', r.error ?? 'unknown')
      }
    })
    .catch(() => {})

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
