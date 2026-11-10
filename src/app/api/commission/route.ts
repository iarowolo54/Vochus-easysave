import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { money } from '@/lib/wallet-guard'
import { summariseByMonth } from '@/lib/commission-history'
import { loadCommissionEntries } from '@/lib/commission-entries'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

  const [registrationTxns, savingTxns, redemptionTxns, rewardsThisMonth, entries, recentRewards] = await Promise.all([
    prisma.transaction.findMany({
      where: { agentId: agent.id, type: 'registration', createdAt: { gte: startOfMonth, lte: endOfMonth } },
      select: { id: true },
    }),
    prisma.transaction.findMany({
      where: { agentId: agent.id, type: 'saving', createdAt: { gte: startOfMonth, lte: endOfMonth } },
      select: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { agentId: agent.id, type: 'redemption', createdAt: { gte: startOfMonth, lte: endOfMonth } },
      select: { amount: true },
    }),
    prisma.agentReward.findMany({
      where: { agentId: agent.id, createdAt: { gte: startOfMonth, lte: endOfMonth } },
      include: { customer: { select: { firstName: true, lastName: true, customerId: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    loadCommissionEntries(agent.id),
    prisma.agentReward.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { customer: { select: { firstName: true, lastName: true, customerId: true } } },
    }),
  ])

  const savingsVolume = savingTxns.reduce((s, t) => s + t.amount, 0)
  const redemptionVolume = redemptionTxns.reduce((s, t) => s + t.amount, 0)
  const enrolCount = registrationTxns.length
  const rewardsTotal = money(rewardsThisMonth.reduce((s, r) => s + r.amount, 0))
  // What was really earned, event by event. The balance is a separate figure: it falls when the agent withdraws.
  const [thisMonth, ...earlierMonths] = summariseByMonth(entries, now)

  const breakdown: Record<string, unknown> = {}

  if (savingTxns.length > 0 || thisMonth.bySource.savings > 0) {
    breakdown.savings = { count: savingTxns.length, volume: money(savingsVolume), commission: thisMonth.bySource.savings }
  }

  if (redemptionTxns.length > 0 || thisMonth.bySource.redemption > 0) {
    breakdown.redemptions = { count: redemptionTxns.length, volume: money(redemptionVolume), commission: thisMonth.bySource.redemption }
  }

  const loanCommission = money(thisMonth.bySource.loan + thisMonth.bySource.repayment)
  if (loanCommission > 0) breakdown.loans = { commission: loanCommission }

  breakdown.enrolments = { count: enrolCount }

  if (rewardsThisMonth.length > 0) {
    breakdown.rewards = rewardsThisMonth.map(r => ({
      customerId: r.customer.customerId,
      customerName: `${r.customer.firstName} ${r.customer.lastName}`,
      type: r.type,
      amount: r.amount,
    }))
    breakdown.rewardsTotal = rewardsTotal
  }

  const currentMonth = {
    id: 'live',
    month: thisMonth.month,
    year: thisMonth.year,
    amount: thisMonth.total,
    breakdown: JSON.stringify(breakdown),
    createdAt: now.toISOString(),
  }

  const prev = earlierMonths.map(m => ({
    id: `${m.year}-${m.month}`,
    month: m.month,
    year: m.year,
    amount: m.total,
    breakdown: null,
    createdAt: new Date(m.year, m.month - 1, 1).toISOString(),
  }))

  return NextResponse.json({ commissions: [currentMonth, ...prev], rewards: recentRewards, available: money(agent.commissionBalance) })
}
