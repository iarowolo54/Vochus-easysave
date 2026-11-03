import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const guard = await requirePermission('redemptions', 'view')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const date = searchParams.get('date') ?? ''

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const where: Record<string, unknown> = { type: 'redemption' }
  if (search) {
    where.OR = [
      { ref: { contains: search } },
      { customer: { firstName: { contains: search } } },
      { customer: { lastName: { contains: search } } },
      { agent: { name: { contains: search } } },
    ]
  }
  if (date) {
    const d = new Date(date)
    const next = new Date(d)
    next.setDate(next.getDate() + 1)
    where.createdAt = { gte: d, lt: next }
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: {
      agent: { select: { name: true, agentId: true } },
      customer: { select: { firstName: true, lastName: true, customerId: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const all = await prisma.transaction.findMany({
    where: { type: 'redemption' },
    select: { amount: true, createdAt: true },
  })

  const todayTxns = all.filter(t => t.createdAt >= todayStart)

  return NextResponse.json({
    redemptions: transactions.map(t => ({
      id: t.id,
      ref: t.ref,
      amount: t.amount,
      customerName: t.customer ? `${t.customer.firstName} ${t.customer.lastName}` : null,
      customerId: t.customer?.customerId ?? null,
      agentName: t.agent.name,
      agentId: t.agent.agentId,
      method: t.method,
      status: t.status,
      createdAt: t.createdAt,
    })),
    totalRedemptions: all.length,
    totalRedeemedAmount: all.reduce((s, t) => s + t.amount, 0),
    todayCount: todayTxns.length,
    todayAmount: todayTxns.reduce((s, t) => s + t.amount, 0),
  })
}
