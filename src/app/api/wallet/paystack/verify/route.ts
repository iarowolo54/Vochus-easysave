import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { reference } = await req.json()
  if (!reference) return NextResponse.json({ error: 'Missing reference' }, { status: 400 })

  logAudit({
    action: 'agent_wallet_topup_verify_attempted',
    entity: 'Transaction',
    details: `Agent ${agent.name} (${agent.agentId}) submitted wallet top-up verification — ref ${reference}`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  const existing = await prisma.transaction.findUnique({ where: { ref: reference } })
  if (existing) {
    return NextResponse.json({ alreadyProcessed: true, newBalance: agent.walletBalance })
  }

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  })
  const data = await res.json()

  if (!data.status || data.data?.status !== 'success') {
    logAudit({
      action: 'agent_wallet_topup_verify_failed',
      entity: 'Transaction',
      details: `Agent ${agent.name} (${agent.agentId}) wallet top-up verification failed — ref ${reference} — Paystack status: ${data.data?.status ?? 'unknown'}`,
      actorType: 'agent',
      actorId: agent.id,
      actorName: agent.name,
    })
    return NextResponse.json({ error: 'Payment not successful' }, { status: 400 })
  }

  const txData = data.data
  const meta = txData.metadata ?? {}

  if (meta.agentId && meta.agentId !== agent.id) {
    return NextResponse.json({ error: 'Reference mismatch' }, { status: 403 })
  }

  const amount = txData.amount / 100
  const walletAfter = agent.walletBalance + amount

  const [txn, updated] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        ref: reference,
        agentId: agent.id,
        type: 'wallet_funding',
        amount,
        method: 'Paystack',
        status: 'Done',
        note: `Paystack top-up — ${txData.channel ?? 'card'}`,
        walletAfter,
      },
    }),
    prisma.agent.update({
      where: { id: agent.id },
      data: { walletBalance: { increment: amount } },
    }),
  ])

  logAudit({
    action: 'wallet_fund_paystack',
    entity: 'Wallet',
    entityId: agent.id,
    details: `Paystack wallet top-up ₦${amount} for ${agent.name} (${agent.agentId}) — ref ${reference}`,
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ transaction: txn, newBalance: updated.walletBalance })
}
