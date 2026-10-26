import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { money } from '@/lib/wallet-guard'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

  const [registrationTxns, savingTxns, redemptionTxns, rewardsThisMonth, previousCommissions, recentRewards] = await Promise.all([
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
    prisma.commission.findMany({
      where: { agentId: agent.id },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    }),
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
  const redemptionComm = money(agent.commissionBalance - rewardsTotal)
  const availableBalance = money(agent.commissionBalance)

  const breakdown: Record<string, any> = {}

  if (savingTxns.length > 0) {
    breakdown.savings = { count: savingTxns.length, volume: money(savingsVolume), commission: 0 }
  }

  if (redemptionTxns.length > 0) {
    breakdown.redemptions = { count: redemptionTxns.length, volume: money(redemptionVolume), commission: redemptionComm }
  }

  breakdown.enrolments = { count: enrolCount, commission: 0 }

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
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    amount: availableBalance,
    breakdown: JSON.stringify(breakdown),
    createdAt: now.toISOString(),
  }

  const prev = previousCommissions.filter(
    c => !(c.month === now.getMonth() + 1 && c.year === now.getFullYear())
  )

  return NextResponse.json({ commissions: [currentMonth, ...prev], rewards: recentRewards })
}
