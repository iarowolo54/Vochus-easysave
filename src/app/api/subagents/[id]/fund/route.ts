import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { debitAgentBalance } from '@/lib/wallet-debit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const subAgent = await prisma.subAgent.findFirst({ where: { id, parentAgentId: agent.id } })
  if (!subAgent) return NextResponse.json({ error: 'Sub-agent not found' }, { status: 404 })

  const body = await req.json()
  const amount = parseFloat(body.amount)
  if (!amount || amount <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })

  try {
    await prisma.$transaction(async (tx) => {
      // Atomically debit the parent agent; concurrent funds can't overdraw.
      const debited = await debitAgentBalance(tx, agent.id, 'walletBalance', amount)
      if (!debited) throw new Error('INSUFFICIENT')
      await tx.subAgent.update({ where: { id: subAgent.id }, data: { walletBalance: { increment: amount } } })
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'INSUFFICIENT') {
      return NextResponse.json({ error: 'Insufficient wallet balance' }, { status: 400 })
    }
    throw e
  }

  logAudit({
    action: 'subagent_fund',
    entity: 'SubAgent',
    entityId: subAgent.id,
    details: `Funded sub-agent ${subAgent.name} wallet with ₦${amount}`,
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ success: true })
}
