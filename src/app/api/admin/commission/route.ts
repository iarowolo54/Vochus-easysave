import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { money } from '@/lib/money'
import { legacyPlatformShare } from '@/lib/commission-ledger'
import { IN_FLIGHT_WITHDRAWAL_STATUSES } from '@/lib/redemption-statuses'

export async function GET() {
  const guard = await requirePermission('commission', 'view')
  if (!guard.ok) return guard.response
  const session = guard.session

  const [agents, withdrawals, oldPayouts] = await Promise.all([
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
    prisma.agentWithdrawal.groupBy({ by: ['status'], _sum: { amount: true } }),
    // The retired "Pay commission" buttons: these took commission off the agent's balance without paying them.
    prisma.transaction.aggregate({ where: { type: 'commission_payout' }, _sum: { amount: true } }),
  ])

  const totalPending = agents.reduce((s, a) => s + a.commissionBalance, 0)
  // Paid out means an approved agent withdrawal, the same figure as the Withdrawals screen.
  const withdrawn = (statuses: readonly string[]) =>
    withdrawals.filter(w => statuses.includes(w.status)).reduce((s, w) => s + (w._sum.amount ?? 0), 0)
  const totalDisbursed = money(withdrawn(['Approved']))
  // A withdrawal leaves the balance when it's requested, so requests still in progress count as earned too.
  const totalEarned = money(totalPending + totalDisbursed + withdrawn(IN_FLIGHT_WITHDRAWAL_STATUSES) + (oldPayouts._sum.amount ?? 0))

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

  return NextResponse.json({ totalPending, totalDisbursed, totalEarned, leaderboard, systemCommission })
}
