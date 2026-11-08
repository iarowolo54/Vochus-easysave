import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { lagosDay, openRound, potOf, roundDueDay, roundLabel, type AjoCadence } from '@/lib/ajo'

/** Every Ajo group, read-only: where each stands, and which rounds are overdue. */
export async function GET() {
  const guard = await requirePermission('ajo', 'view')
  if (!guard.ok) return guard.response
  const today = lagosDay(new Date())
  const rows = await prisma.ajoGroup.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, name: true, code: true, cadence: true, size: true, contribution: true, startDate: true, status: true,
      agent: { select: { name: true, agentId: true } },
      payouts: { select: { round: true, amount: true } },
      contributions: { select: { round: true, amount: true } },
      _count: { select: { members: true } },
    },
  })
  const groups = rows.map(g => {
    const cadence = g.cadence as AjoCadence
    const round = g.status === 'Running' ? openRound(g.size, g.payouts.map(p => p.round)) : null
    const paidThisRound = round ? g.contributions.filter(c => c.round === round).length : 0
    const dueDay = round ? roundDueDay(g.startDate, cadence, round) : null
    const paidIn = g.contributions.reduce((s, c) => s + c.amount, 0)
    const paidOut = g.payouts.reduce((s, p) => s + p.amount, 0)
    return {
      id: g.id, name: g.name, status: g.status, cadence, size: g.size, contribution: g.contribution, pot: potOf(g),
      agentName: g.agent.name, agentCode: g.agent.agentId, memberCount: g._count.members,
      round, roundLabel: round ? roundLabel(g.startDate, cadence, round) : null, paidThisRound, dueDay,
      overdue: !!dueDay && dueDay < today && paidThisRound < g.size,
      inPool: Math.round((paidIn - paidOut) * 100) / 100, paidOutRounds: g.payouts.length,
    }
  })
  return NextResponse.json({ groups }, { headers: { 'Cache-Control': 'no-store' } })
}
