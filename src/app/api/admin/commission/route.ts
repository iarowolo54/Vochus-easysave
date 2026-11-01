import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const guard = await requirePermission('agents')
  if (!guard.ok) return guard.response
  const session = guard.session

  const [agents, payoutTxns] = await Promise.all([
    prisma.agent.findMany({
      select: {
        id: true,
        name: true,
        agentId: true,
        commissionBalance: true,
        status: true,
        _count: { select: { customers: true } },
        transactions: {
          where: { type: 'saving' },
          select: { amount: true },
        },
      },
      orderBy: { commissionBalance: 'desc' },
    }),
    prisma.transaction.findMany({
      where: { type: 'commission_payout' },
      select: { amount: true },
    }),
  ])

  const totalPending = agents.reduce((s, a) => s + a.commissionBalance, 0)
  const totalDisbursed = payoutTxns.reduce((s, t) => s + t.amount, 0)

  const leaderboard = agents.map((a, i) => ({
    rank: i + 1,
    id: a.id,
    agentId: a.agentId,
    name: a.name,
    status: a.status,
    customerCount: a._count.customers,
    savingsVolume: a.transactions.reduce((s, t) => s + t.amount, 0),
    commissionBalance: a.commissionBalance,
  }))

  return NextResponse.json({ totalPending, totalDisbursed, leaderboard })
}
