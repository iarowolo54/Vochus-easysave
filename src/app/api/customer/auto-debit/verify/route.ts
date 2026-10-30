import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { money } from '@/lib/wallet-guard'
import { logAudit } from '@/lib/audit'
import { verifyTransaction } from '@/lib/paystack'
import { findOwnedPendingIntent, consumePaymentIntent } from '@/lib/payment-intent'
import { createMandateFromAuthorization } from '@/lib/auto-debit'

class RouteError extends Error {
  constructor(public code: 'ALREADY_PROCESSED' | 'NOT_REUSABLE' | 'NOT_SELF') {
    super(code)
  }
}

export async function POST(req: NextRequest) {
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
  const prior = await prisma.transaction.findUnique({ where: { ref: reference }, select: { customerId: true } })
  if (prior) {
    if (prior.customerId !== customer.id) return NextResponse.json({ error: 'Reference mismatch' }, { status: 403 })
    return NextResponse.json({ alreadyProcessed: true, active: true })
  }

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
  if (!verified.authorization) {
    return NextResponse.json({ error: 'Card cannot be used for auto-debit' }, { status: 400 })
  }
  const authorization = verified.authorization
  const amount = money(intent.amount)

  const plan = intent.planId
    ? await prisma.savingsPlan.findFirst({
        where: { id: intent.planId, customerId: customer.id, status: 'Active', source: 'self' },
      })
    : null
  if (!plan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const email = customer.email ?? `${customer.customerId.toLowerCase()}@vochus.ng`

  try {
    await prisma.$transaction(async (tx) => {
      const consumed = await consumePaymentIntent(tx, reference, { customerId: customer.id })
      if (!consumed) throw new RouteError('ALREADY_PROCESSED')

      // 'exists' = already enrolled: idempotent, still credit the charge that was taken.
      const m = await createMandateFromAuthorization(tx, {
        customerId: customer.id,
        plan: { id: plan.id, source: plan.source, cadence: plan.cadence, dailyAmount: plan.dailyAmount },
        email,
        authorization,
      })
      if ('error' in m) {
        if (m.error === 'not_reusable') throw new RouteError('NOT_REUSABLE')
        if (m.error === 'not_self') throw new RouteError('NOT_SELF')
      }

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
          note: 'Auto-debit enrollment first charge',
        },
      })
      await tx.savingsPlan.update({ where: { id: plan.id }, data: { balance: { increment: amount } } })
    })
  } catch (e) {
    if (e instanceof RouteError) {
      if (e.code === 'ALREADY_PROCESSED') return NextResponse.json({ alreadyProcessed: true, active: true })
      const msg = e.code === 'NOT_REUSABLE' ? 'This card cannot be used for auto-debit' : 'Auto-debit is only available on online plans'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002') {
      return NextResponse.json({ alreadyProcessed: true, active: true })
    }
    throw e
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
