import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { money } from '@/lib/wallet-guard'
import { logAudit } from '@/lib/audit'
import { creditRegistrationReward } from '@/lib/reward'

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
  const meta = txData.metadata ?? {}
  const amount = money(txData.amount / 100)

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (meta.customerId && meta.customerId !== customer.id) {
    return NextResponse.json({ error: 'Reference mismatch' }, { status: 403 })
  }

  const priorSavings = await prisma.transaction.count({
    where: { customerId: customer.id, type: 'saving' },
  })

  const plan = await prisma.savingsPlan.findFirst({
    where: { customerId: customer.id, status: 'Active' },
    orderBy: { startDate: 'desc' },
  })
  if (!plan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const agent = await prisma.agent.findUnique({ where: { id: customer.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  try {
    await prisma.$transaction([
      prisma.transaction.create({
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
      }),
      prisma.savingsPlan.update({
        where: { id: plan.id },
        data: { balance: { increment: amount } },
      }),
      prisma.customerPayment.create({
        data: {
          ref: `PAY-${reference}`,
          customerId: customer.id,
          planId: plan.id,
          amount,
          status: 'Done',
          channel: txData.channel ?? 'card',
        },
      }),
    ])
  } catch (e: any) {
    if (e?.code === 'P2002') {
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
