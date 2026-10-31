import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const agents = await prisma.agent.findMany({
    include: {
      transactions: {
        where: { type: 'wallet_funding' },
        select: { amount: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { name: 'asc' },
  })

  let totalWalletBalance = 0
  let totalFundedToday = 0
  let lowBalanceCount = 0

  const list = agents.map(a => {
    const todayFunding = a.transactions.filter(t => t.createdAt >= todayStart)
    const todayActivity = todayFunding.reduce((s, t) => s + t.amount, 0)
    const lastFunded = a.transactions[0]?.createdAt ?? null

    totalWalletBalance += a.walletBalance
    totalFundedToday += todayActivity
    if (a.walletBalance < 10000) lowBalanceCount++

    return {
      id: a.id,
      agentId: a.agentId,
      name: a.name,
      location: a.location,
      walletBalance: a.walletBalance,
      commissionBalance: a.commissionBalance,
      floatLimit: a.floatLimit,
      status: a.status,
      todayActivity,
      lastFunded,
    }
  })

  return NextResponse.json({ agents: list, totalWalletBalance, totalFundedToday, lowBalanceCount })
}
