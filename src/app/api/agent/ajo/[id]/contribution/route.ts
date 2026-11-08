import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { openRound } from '@/lib/ajo'
import { sessionAgent } from '@/lib/ajo-server'
import { AjoAlreadyPaidError, AjoRoundClosedError, ajoRef, recordContribution, type PayoutDone } from '@/lib/ajo-settle'
import { debitAgentBalance } from '@/lib/wallet-debit'
import { InsufficientFundsError, insufficientResponse, money } from '@/lib/wallet-guard'

const ALREADY = 'They’ve already paid this round.'

/**
 * The agent took a member's contribution in cash: { memberId }. Like Record savings, the agent's wallet pays it in
 * (the agent keeps the cash). Only the open round, only the agent's own group.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const agent = await sessionAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const g = await prisma.ajoGroup.findFirst({ where: { id, agentId: agent.id }, select: { id: true, name: true, status: true, size: true, contribution: true, payouts: { select: { round: true } } } })
  if (!g) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (g.status !== 'Running') return NextResponse.json({ error: g.status === 'Forming' ? 'Start the group before taking payments.' : 'This group has finished.' }, { status: 409 })
  const round = openRound(g.size, g.payouts.map(p => p.round))
  if (round === null) return NextResponse.json({ error: 'This group has finished.' }, { status: 409 })

  const body: unknown = await req.json().catch(() => null)
  const memberId = body && typeof body === 'object' ? (body as { memberId?: unknown }).memberId : undefined
  if (typeof memberId !== 'string') return NextResponse.json({ error: 'Choose a member.' }, { status: 400 })
  const member = await prisma.ajoMember.findFirst({ where: { id: memberId, groupId: g.id }, select: { id: true, customer: { select: { firstName: true, lastName: true, customerId: true } } } })
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const amount = money(g.contribution)
  const ref = ajoRef('CON')
  let payout: PayoutDone | null = null
  try {
    payout = await prisma.$transaction(async tx => {
      if (await tx.ajoContribution.count({ where: { memberId: member.id, round } })) throw new AjoAlreadyPaidError()
      // Conditional debit: two quick taps (or two phones) can't overdraw the wallet.
      if (!(await debitAgentBalance(tx, agent.id, 'walletBalance', amount))) {
        const w = await tx.agent.findUnique({ where: { id: agent.id }, select: { walletBalance: true } })
        throw new InsufficientFundsError('Agent wallet', w?.walletBalance ?? 0, amount)
      }
      const after = await tx.agent.findUnique({ where: { id: agent.id }, select: { walletBalance: true } })
      return (await recordContribution(tx, { groupId: g.id, memberId: member.id, round, amount, method: 'cash', ref, agentId: agent.id, walletAfter: after?.walletBalance })).payout
    })
  } catch (e) {
    if (e instanceof InsufficientFundsError) return insufficientResponse(e)
    if (e instanceof AjoAlreadyPaidError || (e as { code?: string })?.code === 'P2002') return NextResponse.json({ error: ALREADY }, { status: 409 })
    if (e instanceof AjoRoundClosedError) return NextResponse.json({ error: 'That round is closed. Refresh the group.' }, { status: 409 })
    throw e
  }
  logAudit({
    action: 'ajo_contribution', entity: 'AjoGroup', entityId: g.id,
    details: `Agent ${agent.name} (${agent.agentId}) took ₦${amount} cash from ${member.customer.firstName} ${member.customer.lastName} (${member.customer.customerId}) for Ajo group "${g.name}" round ${round} — ref ${ref}${payout ? ` — round complete, ₦${payout.amount} moved to the holder’s payout plan` : ''}`,
    actorType: 'agent', actorId: agent.id, actorName: agent.name,
  })
  return NextResponse.json({ ok: true, ref, round, roundComplete: !!payout, groupComplete: !!payout?.groupCompleted })
}
