import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { money } from '@/lib/money'
import { legacyPlatformShare } from '@/lib/commission-ledger'

export async function GET() {
  const guard = await requirePermission('commission', 'view')
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

  // The platform's own commission: every platform row in the ledger, plus the platform part of collection fees approved before
  // the ledger existed (those are worked out from the old 3/5, 2/5 split, and any already in the ledger are skipped).
  const [platformRows, olderCollections, coveredRows] = await Promise.all([
    prisma.commissionLedger.groupBy({ by: ['source'], where: { party: 'platform' }, _sum: { amount: true } }),
    prisma.earlyRedemption.findMany({ where: { status: 'Approved', feeRule: 'v1', penalty: { gt: 0 } }, select: { ref: true, penalty: true } }),
    prisma.commissionLedger.findMany({ where: { party: 'platform', source: 'redemption_fee' }, select: { sourceRef: true } }),
  ])
  const sumOf = (source: string) => platformRows.find(r => r.source === source)?._sum.amount ?? 0
  const earlier = legacyPlatformShare(olderCollections, new Set(coveredRows.map(r => r.sourceRef)))
  const savingsFees = money(['daily_first', 'periodic_fee', 'settle_up', 'redemption_fee'].reduce((t, k) => t + sumOf(k), 0) + earlier)
  const loanShare = money(sumOf('loan'))
  const systemCommission = { savingsFees, loanShare, total: money(savingsFees + loanShare) }

  return NextResponse.json({ totalPending, totalDisbursed, leaderboard, systemCommission })
}
