import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const guard = await requirePermission('loans', 'view')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? ''

  // Optional cap for callers that only need the newest few (the overview). No limit = full list.
  const limitRaw = searchParams.get('limit') ?? ''
  const limit = /^\d+$/.test(limitRaw) && Number(limitRaw) > 0 ? Math.min(Number(limitRaw), 200) : undefined

  const where: any = {}
  if (status) {
    const statuses = status.split(',').map(s => s.trim())
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses }
  }

  const loans = await prisma.loan.findMany({
    where,
    include: {
      customer: { select: { firstName: true, lastName: true, customerId: true } },
      agent: { select: { name: true, agentId: true } },
    },
    orderBy: { createdAt: 'desc' },
    ...(limit && { take: limit }),
  })

  return NextResponse.json({
    loans: loans.map(l => ({
      id: l.id,
      ref: l.ref,
      principal: l.principal,
      interestRate: l.interestRate,
      interestAmount: l.interestAmount,
      totalAmount: l.totalAmount,
      durationDays: l.durationDays,
      dueDate: l.dueDate,
      status: l.status,
      approvedBy: l.approvedBy,
      createdAt: l.createdAt,
      // A loan outlives a deleted customer (the link is cleared), so a missing one shows as deleted instead of failing the list.
      customerName: l.customer ? `${l.customer.firstName} ${l.customer.lastName}` : 'Deleted customer',
      customerId: l.customer?.customerId ?? '—',
      agentName: l.agent.name,
      agentId: l.agent.agentId,
    })),
  })
}
