import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { money } from '@/lib/wallet-guard'
import { creditRegistrationReward } from '@/lib/reward'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('x-paystack-signature') ?? ''
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET
  // Fail closed: never verify against an empty secret (an empty HMAC key is forgeable).
  if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })

  const expected = crypto.createHmac('sha512', secret).update(body).digest('hex')
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(body)

  logAudit({
    action: 'paystack_webhook_received',
    entity: 'Transaction',
    details: `Paystack webhook received — event: ${event.event}, ref: ${event.data?.reference ?? 'N/A'}, amount: ₦${event.data?.amount ? (event.data.amount / 100).toLocaleString() : 'N/A'}`,
    actorType: 'system',
    actorName: 'Paystack Webhook',
  })

  if (event.event !== 'charge.success') return NextResponse.json({ ok: true })

  const txData = event.data
  const reference = txData.reference as string
  const meta = txData.metadata ?? {}
  const agentId = meta.agentId as string | undefined
  const customerId = meta.customerId as string | undefined

  const existing = await prisma.transaction.findUnique({ where: { ref: reference } })
  if (existing) return NextResponse.json({ ok: true })

  // Customer self-pay: credit savings plan
  if (customerId) {
    const amount = money(txData.amount / 100)

    const customer = await prisma.customer.findUnique({ where: { id: customerId } })
    if (!customer) return NextResponse.json({ ok: true })

    const planId = meta.planId as string | undefined
    const plan = planId
      ? await prisma.savingsPlan.findFirst({ where: { id: planId, customerId, status: 'Active' } })
      : await prisma.savingsPlan.findFirst({ where: { customerId, status: 'Active' }, orderBy: { startDate: 'desc' } })
    if (!plan) return NextResponse.json({ ok: true })

    const agent = await prisma.agent.findUnique({ where: { id: customer.agentId } })
    if (!agent) return NextResponse.json({ ok: true })

    const priorSavings = await prisma.transaction.count({ where: { customerId, type: 'saving' } })

    try {
      await prisma.$transaction([
        prisma.transaction.create({
          data: {
            ref: reference,
            agentId: agent.id,
            customerId,
            planId: plan.id,
            type: 'saving',
            amount,
            method: 'Paystack',
            status: 'Done',
            note: `Customer self-pay via Paystack webhook — ${txData.channel ?? 'card'}`,
          },
        }),
        prisma.savingsPlan.update({
          where: { id: plan.id },
          data: { balance: { increment: amount } },
        }),
        prisma.customerPayment.create({
          data: {
            ref: `PAY-${reference}`,
            customerId,
            planId: plan.id,
            amount,
            status: 'Done',
            channel: txData.channel ?? 'card',
          },
        }),
      ])
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e
    }

    logAudit({
      action: 'customer_paystack_payment',
      entity: 'Transaction',
      details: `${customer.firstName} ${customer.lastName} (${customer.customerId}) paid ₦${amount.toLocaleString()} via Paystack webhook — ref ${reference}`,
      actorType: 'system',
      actorName: 'Paystack Webhook',
    })

    if (priorSavings === 0) creditRegistrationReward(customer).catch(() => {})

    return NextResponse.json({ ok: true })
  }

  // Agent wallet funding
  if (!agentId) return NextResponse.json({ ok: true })

  const agent = await prisma.agent.findUnique({ where: { id: agentId } })
  if (!agent) return NextResponse.json({ ok: true })

  const amount = txData.amount / 100
  const walletAfter = agent.walletBalance + amount

  await prisma.$transaction([
    prisma.transaction.create({
      data: {
        ref: reference,
        agentId: agent.id,
        type: 'wallet_funding',
        amount,
        method: 'Paystack',
        status: 'Done',
        note: `Paystack webhook — ${txData.channel ?? 'card'}`,
        walletAfter,
      },
    }),
    prisma.agent.update({
      where: { id: agent.id },
      data: { walletBalance: { increment: amount } },
    }),
  ])

  logAudit({
    action: 'agent_wallet_funded_webhook',
    entity: 'Agent',
    entityId: agent.id,
    details: `Agent ${agent.name} (${agent.agentId}) wallet funded ₦${amount.toLocaleString()} via Paystack webhook — ref ${reference}`,
    actorType: 'system',
    actorName: 'Paystack Webhook',
  })

  return NextResponse.json({ ok: true })
}
