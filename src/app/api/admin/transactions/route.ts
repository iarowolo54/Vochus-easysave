import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { parsePaging } from '@/lib/paging'
import { rankMatches } from '@/lib/fuzzy'

export async function GET(req: NextRequest) {
  const guard = await requirePermission('transactions', 'view')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? ''
  const date = searchParams.get('date') ?? ''

  const { page, limit, skip } = parsePaging(searchParams)

  const search = (searchParams.get('search') ?? '').trim()

  const where: any = {}
  if (search) {
    // Customers and agents are small tables: rank them in memory so a typo still finds the person,
    // then fetch only their transactions (plus any reference that contains the text).
    const [customers, agents] = await Promise.all([
      prisma.customer.findMany({ select: { id: true, firstName: true, lastName: true, customerId: true } }),
      prisma.agent.findMany({ select: { id: true, name: true, agentId: true } }),
    ])
    const customerIds = rankMatches(search, customers, c => [c.firstName, c.lastName, c.customerId], 300).map(c => c.id)
    const agentIds = rankMatches(search, agents, a => [a.name, a.agentId], 100).map(a => a.id)
    where.OR = [
      { ref: { contains: search } },
      { customerId: { in: customerIds } },
      { agentId: { in: agentIds } },
    ]
  }
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
      // An agent's payment into an online customer's plan reads as that, not as a plain cash deposit.
      method: t.paidByAgentId ? 'Paid by agent' : t.method,
      paidByAgent: t.paidByAgentId != null,
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
