import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const guard = await requirePermission('loans')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? ''

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
      customerName: `${l.customer.firstName} ${l.customer.lastName}`,
      customerId: l.customer.customerId,
      agentName: l.agent.name,
      agentId: l.agent.agentId,
    })),
  })
}
