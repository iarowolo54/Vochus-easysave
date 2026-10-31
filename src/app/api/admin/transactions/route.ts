import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { parsePaging } from '@/lib/paging'

export async function GET(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? ''
  const date = searchParams.get('date') ?? ''

  const { page, limit, skip } = parsePaging(searchParams)

  const where: any = {}
  if (type) where.type = type
  if (date) {
    const d = new Date(date)
    const next = new Date(d)
    next.setDate(next.getDate() + 1)
    where.createdAt = { gte: d, lt: next }
  }

  const [total, transactions] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
    where,
    include: {
      agent: { select: { name: true, agentId: true } },
      customer: { select: { firstName: true, lastName: true, customerId: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip,
  }),
  ])

  return NextResponse.json({
    total,
    page,
    limit,
    transactions: transactions.map(t => ({
      id: t.id,
      ref: t.ref,
      type: t.type,
      amount: t.amount,
      method: t.method,
      status: t.status,
      note: t.note,
      createdAt: t.createdAt,
      agentName: t.agent.name,
      agentId: t.agent.agentId,
      customerName: t.customer ? `${t.customer.firstName} ${t.customer.lastName}` : null,
      customerId: t.customer?.customerId ?? null,
    })),
  })
}
