import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const now = new Date()
  const in7Days = new Date(now)
  in7Days.setDate(in7Days.getDate() + 7)

  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  const [customerCount, activeLoansCount, commission, recentTxns, maturingSoon, allTxns] = await Promise.all([
    prisma.customer.count({ where: { agentId: agent.id } }),
    prisma.loan.count({ where: { agentId: agent.id, status: { in: ['Disbursed'] } } }),
    prisma.commission.findFirst({ where: { agentId: agent.id, month: currentMonth, year: currentYear } }),
    prisma.transaction.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { customer: true },
    }),
    prisma.savingsPlan.findMany({
      where: {
        customer: { agentId: agent.id },
        status: 'Active',
        maturityDate: { gte: now, lte: in7Days },
      },
      include: { customer: true },
      orderBy: { maturityDate: 'asc' },
    }),
    prisma.transaction.findMany({
      where: { agentId: agent.id, type: 'saving', createdAt: { gte: new Date(now.getFullYear(), now.getMonth() - 1, 1) } },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const loanPortfolio = await prisma.loan.aggregate({
    where: { agentId: agent.id, status: 'Disbursed' },
    _sum: { principal: true },
  })

  // Compute weekly collections (last 4 weeks from now)
  const weeklyCollections = []
  for (let w = 3; w >= 0; w--) {
    const end = new Date(now)
    end.setDate(end.getDate() - w * 7)
    const start = new Date(end)
    start.setDate(start.getDate() - 7)
    const weekTxns = allTxns.filter(t => t.createdAt >= start && t.createdAt < end)
    const total = weekTxns.reduce((s, t) => s + t.amount, 0)
    weeklyCollections.push({ label: `W${4 - w}`, total })
  }

  return NextResponse.json({
    walletBalance: agent.walletBalance,
    customerCount,
    monthlyCommission: commission?.amount ?? 0,
    activeLoansCount,
    loanPortfolio: loanPortfolio._sum.principal ?? 0,
    recentTransactions: recentTxns.map(t => ({
      id: t.id,
      ref: t.ref,
      type: t.type,
      amount: t.amount,
      status: t.status,
      createdAt: t.createdAt,
      customer: t.customer ? { name: `${t.customer.firstName} ${t.customer.lastName}`, customerId: t.customer.customerId } : null,
    })),
    maturingSoon: maturingSoon.map(p => ({
      id: p.id,
      balance: p.balance,
      maturityDate: p.maturityDate,
      customer: { name: `${p.customer.firstName} ${p.customer.lastName}`, customerId: p.customer.customerId },
    })),
    weeklyCollections,
  })
}
