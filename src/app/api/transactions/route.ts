import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { listedStatuses } from '@/lib/receipt-payout'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? ''
  const date = searchParams.get('date') ?? ''
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))

  const customerId = searchParams.get('customerId') ?? ''
  const where: any = { agentId: agent.id }
  if (type) where.type = type
  if (customerId) where.customerId = customerId
  if (date) {
    const d = new Date(date)
    const next = new Date(d)
    next.setDate(next.getDate() + 1)
    where.createdAt = { gte: d, lt: next }
  }

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const statsWhere = { agentId: agent.id, createdAt: { gte: todayStart } }

  const [transactions, total, todayTxns] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({ where: statsWhere }),
  ])

  const todaySavings = todayTxns.filter(t => t.type === 'saving').reduce((s, t) => s + t.amount, 0)
  const todaySavingsCount = todayTxns.filter(t => t.type === 'saving').length
  const todayRedemptions = todayTxns.filter(t => t.type === 'redemption').reduce((s, t) => s + t.amount, 0)
  const todayRedemptionsCount = todayTxns.filter(t => t.type === 'redemption').length
  const todayRepayments = todayTxns.filter(t => t.type === 'repayment').reduce((s, t) => s + t.amount, 0)
  const todayRepaymentsCount = todayTxns.filter(t => t.type === 'repayment').length
  const totalVolume = todayTxns.reduce((s, t) => s + t.amount, 0)

  const statuses = await listedStatuses(transactions)

  return NextResponse.json({
    transactions: transactions.map(t => ({
      id: t.id,
      ref: t.ref,
      type: t.type,
      amount: t.amount,
      // An agent's payment into an online customer's plan reads as that, not as a plain cash deposit.
      method: t.paidByAgentId ? 'Paid by agent' : t.method,
      paidByAgent: t.paidByAgentId != null,
      status: statuses.get(t.id) ?? t.status,
      note: t.note,
      planId: t.planId,
      createdAt: t.createdAt,
      customer: t.customer
        ? { name: `${t.customer.firstName} ${t.customer.lastName}`, customerId: t.customer.customerId }
        : null,
    })),
    total,
    page,
    limit,
    stats: {
      todaySavings, todaySavingsCount,
      todayRedemptions, todayRedemptionsCount,
      todayRepayments, todayRepaymentsCount,
      totalVolume, totalCount: todayTxns.length,
    },
  })
}
