import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { money } from '@/lib/wallet-guard'
import { logAudit } from '@/lib/audit'
import { verifyTransaction } from '@/lib/paystack'
import { findOwnedPendingIntent, consumePaymentIntent, INTENT_REVIEW } from '@/lib/payment-intent'
import { sendToReview } from '@/lib/customer-settle'
import { PlanClosedError, creditPlanBalance } from '@/lib/plan-credit'
import { createMandateFromAuthorization } from '@/lib/auto-debit'
import { ensureEnrolmentMandate, isEnrolmentRef } from '@/lib/auto-debit-enrol'
import { depositFeeOps } from '@/lib/commission-ledger'
import { PAYSTACK_ENABLED, paystackOff } from '@/lib/paystack-off'

class RouteError extends Error {
  constructor(public code: 'ALREADY_PROCESSED' | 'NOT_SELF') {
    super(code)
  }
}

// A replayed enrollment ref: active only if a mandate exists (a non-reusable card was saved instead).
async function replayResponse(planId: string | null, reference?: string) {
  // The webhook can credit the charge first, and used to leave the money saved with no mandate. Finish it here.
  if (reference && isEnrolmentRef(reference)) {
    try {
      const again = await verifyTransaction(reference)
      if (again.status === 'success') await ensureEnrolmentMandate(prisma, reference, again.authorization)
    } catch {
      // Paystack is out of reach: the webhook's redelivery or the next visit finishes it. Report what exists now.
    }
  }
  const mandate = planId
    ? await prisma.autoDebitMandate.findUnique({ where: { savingsPlanId: planId }, select: { id: true } })
    : null
  return NextResponse.json({ alreadyProcessed: true, active: !!mandate })
}

export async function POST(req: NextRequest) {
  // Paystack is closed (see src/lib/paystack-off.ts): no new card can be enrolled.
  if (!PAYSTACK_ENABLED) return paystackOff()
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let reference: unknown
  try {
    reference = ((await req.json()) as { reference?: unknown }).reference
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (typeof reference !== 'string' || !reference) {
    return NextResponse.json({ error: 'Missing reference' }, { status: 400 })
  }

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Replay: this customer's enrollment charge was already credited.
  const prior = await prisma.transaction.findUnique({ where: { ref: reference }, select: { customerId: true, planId: true } })
  if (prior) {
    if (prior.customerId !== customer.id) return NextResponse.json({ error: 'Reference mismatch' }, { status: 403 })
    return replayResponse(prior.planId, reference)
  }

  const anyIntent = await prisma.paymentIntent.findFirst({ where: { ref: reference, customerId: customer.id }, select: { status: true } })
  if (anyIntent?.status === INTENT_REVIEW) return NextResponse.json({ review: true })

  const intent = await findOwnedPendingIntent(reference, { customerId: customer.id })
  if (!intent) return NextResponse.json({ error: 'Reference mismatch' }, { status: 403 })

  let verified: Awaited<ReturnType<typeof verifyTransaction>>
  try {
    verified = await verifyTransaction(reference)
  } catch {
    return NextResponse.json({ error: 'Could not verify payment' }, { status: 502 })
  }
  if (verified.status !== 'success') {
    return NextResponse.json({ error: 'Payment not successful' }, { status: 400 })
  }
  if (verified.currency && verified.currency !== intent.currency) {
    return NextResponse.json({ error: 'Currency mismatch' }, { status: 400 })
  }
  if (money(verified.amountNaira) !== money(intent.amount)) {
    return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 })
  }
  // A reusable authorization yields a mandate. If Paystack confirms the charge but returns no
  // authorization (or a non-reusable one), there is no mandate — but the money WAS taken, so it
  // must still be saved to the plan below (handoff #31), never silently dropped.
  const amount = money(intent.amount)

  const plan = intent.planId
    ? await prisma.savingsPlan.findFirst({ where: { id: intent.planId, customerId: customer.id, source: 'self' } })
    : null
  // The first payment has been taken, but nothing can reach a missing or closed plan: never drop it silently.
  const toReview = async (state: string) => {
    await sendToReview(prisma, intent, reference, `auto-funding first payment of ₦${amount}, plan ${intent.planId ?? 'none'} is ${state}`)
    return NextResponse.json({ review: true })
  }
  if (!plan) return toReview('missing')

  const reusable = verified.authorization?.reusable === true
  const email = customer.email ?? `${customer.customerId.toLowerCase()}@vochus.ng`

  try {
    await prisma.$transaction(async (tx) => {
      const consumed = await consumePaymentIntent(tx, reference, { customerId: customer.id })
      if (!consumed) throw new RouteError('ALREADY_PROCESSED')

      // Non-reusable / no-authorization card: no mandate, but the charge taken is still saved below.
      if (reusable && verified.authorization) {
        // 'exists' = already enrolled: idempotent, still credit the charge that was taken.
        const m = await createMandateFromAuthorization(tx, {
          customerId: customer.id,
          plan: { id: plan.id, source: plan.source, cadence: plan.cadence, dailyAmount: plan.dailyAmount },
          email,
          authorization: verified.authorization,
        })
        if ('error' in m) {
          if (m.error === 'not_reusable') throw new RouteError('NOT_SELF')
          if (m.error === 'not_self') throw new RouteError('NOT_SELF')
        }
      }

      const fee = await depositFeeOps(tx, { planId: plan.id, agentId: customer.agentId, customerId: customer.id, amount, ref: reference })
      await tx.transaction.create({
        data: {
          ref: reference,
          agentId: customer.agentId,
          customerId: customer.id,
          planId: plan.id,
          type: 'saving',
          amount,
          method: 'Paystack',
          status: 'Done',
          feeTaken: fee,
          note: reusable ? 'Auto-debit enrollment first charge' : 'Auto-debit enrollment charge saved (no reusable card authorization)',
        },
      })
      await creditPlanBalance(tx, plan.id, money(amount - fee))
    })
  } catch (e) {
    if (e instanceof PlanClosedError) return toReview('closed')
    if (e instanceof RouteError) {
      if (e.code === 'ALREADY_PROCESSED') return replayResponse(plan.id, reference)
      return NextResponse.json({ error: 'Auto-debit is only available on online plans' }, { status: 400 })
    }
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002') {
      return replayResponse(plan.id, reference)
    }
    throw e
  }

  if (!reusable) {
    logAudit({
      action: 'auto_debit_enroll_saved_instead',
      entity: 'SavingsPlan',
      details: `${customer.firstName} ${customer.lastName} (${customer.customerId}) enrollment card not reusable; N${amount} saved to plan ${plan.id} — ref ${reference}`,
      actorType: 'customer',
      actorId: customer.id,
      actorName: `${customer.firstName} ${customer.lastName}`,
    })
    return NextResponse.json({ active: false, savedInstead: true })
  }

  logAudit({
    action: 'auto_debit_enrolled',
    entity: 'AutoDebitMandate',
    details: `${customer.firstName} ${customer.lastName} (${customer.customerId}) enrolled plan ${plan.id} in auto-debit — ref ${reference}`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: `${customer.firstName} ${customer.lastName}`,
  })

  return NextResponse.json({ active: true })
}
