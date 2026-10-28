import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { money } from '@/lib/wallet-guard'
import { logAudit } from '@/lib/audit'
import { creditRegistrationReward } from '@/lib/reward'
import { findOwnedPendingIntent, consumePaymentIntent } from '@/lib/payment-intent'

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { reference } = await req.json()
  if (!reference) return NextResponse.json({ error: 'Missing reference' }, { status: 400 })

  logAudit({
    action: 'payment_verify_attempted',
    entity: 'Transaction',
    details: `Customer (${session.customerId}) submitted verification for ref ${reference}`,
    actorType: 'customer',
    actorId: session.id,
    actorName: session.name,
  })

  const existing = await prisma.transaction.findUnique({ where: { ref: reference } })
  if (existing) return NextResponse.json({ alreadyProcessed: true })

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  })
  const data = await res.json()

  if (!data.status || data.data?.status !== 'success') {
    logAudit({
      action: 'payment_verify_failed',
      entity: 'Transaction',
      details: `Customer (${session.customerId}) verification failed for ref ${reference} — Paystack status: ${data.data?.status ?? 'unknown'}`,
      actorType: 'customer',
      actorId: session.id,
      actorName: session.name,
    })
    return NextResponse.json({ error: 'Payment not successful' }, { status: 400 })
  }

  const txData = data.data

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Require a server-side intent for THIS customer (reject arbitrary references)
  // and bind the credited amount/currency to what was initiated.
  const intent = await findOwnedPendingIntent(reference, { customerId: customer.id })
  if (!intent) return NextResponse.json({ error: 'Reference mismatch' }, { status: 403 })
  if (txData.currency && txData.currency !== intent.currency) {
    return NextResponse.json({ error: 'Currency mismatch' }, { status: 400 })
  }
  if (money(txData.amount / 100) !== money(intent.amount)) {
    return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 })
  }
  const amount = money(intent.amount)

  const priorSavings = await prisma.transaction.count({
    where: { customerId: customer.id, type: 'saving' },
  })

  // Credit the plan the payment was initiated for (from the intent), confirmed
  // to belong to this customer.
  const plan = intent.planId
    ? await prisma.savingsPlan.findFirst({ where: { id: intent.planId, customerId: customer.id } })
    : null
  if (!plan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const agent = await prisma.agent.findUnique({ where: { id: customer.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  try {
    await prisma.$transaction(async (tx) => {
      // Atomically consume the intent; a losing/replayed call must not credit.
      const consumed = await consumePaymentIntent(tx, reference, { customerId: customer.id })
      if (!consumed) throw new Error('ALREADY_PROCESSED')
      await tx.transaction.create({
        data: {
          ref: reference,
          agentId: agent.id,
          customerId: customer.id,
          planId: plan.id,
          type: 'saving',
          amount,
          method: 'Paystack',
          status: 'Done',
          note: `Customer self-pay via Paystack — ${txData.channel ?? 'card'}`,
        },
      })
      await tx.savingsPlan.update({ where: { id: plan.id }, data: { balance: { increment: amount } } })
      await tx.customerPayment.create({
        data: {
          ref: `PAY-${reference}`,
          customerId: customer.id,
          planId: plan.id,
          amount,
          status: 'Done',
          channel: txData.channel ?? 'card',
        },
      })
    })
  } catch (e: any) {
    if ((e instanceof Error && e.message === 'ALREADY_PROCESSED') || e?.code === 'P2002') {
      const updated = await prisma.savingsPlan.findUnique({ where: { id: plan.id } })
      return NextResponse.json({ alreadyProcessed: true, newBalance: updated?.balance })
    }
    throw e
  }

  const updated = await prisma.savingsPlan.findUnique({ where: { id: plan.id } })

  logAudit({
    action: 'customer_paystack_payment',
    entity: 'Transaction',
    details: `${customer.firstName} ${customer.lastName} (${customer.customerId}) paid ₦${amount.toLocaleString()} via Paystack — ref ${reference}`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: `${customer.firstName} ${customer.lastName}`,
  })

  if (priorSavings === 0) {
    creditRegistrationReward(customer).catch(() => {})
  }

  return NextResponse.json({ amount, newBalance: updated?.balance })
}
