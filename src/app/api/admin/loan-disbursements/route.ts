import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const guard = await requirePermission('loan-disbursements', 'view')
  if (!guard.ok) return guard.response
  const session = guard.session

  const now = new Date()

  const loans = await prisma.loan.findMany({
    where: { status: 'Disbursed' },
    include: {
      agent: { select: { name: true, agentId: true } },
      customer: { select: { firstName: true, lastName: true, customerId: true } },
      repayments: { select: { amount: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Loan has no disbursedAt column; the disburse route writes a `loan_disburse` audit entry keyed
  // by the loan id, which is the stored disbursement time (desc order + Map.set means the earliest wins).
  const disbursedAtByLoan = new Map<string, Date>()
  if (loans.length > 0) {
    const entries = await prisma.auditLog.findMany({
      where: { action: 'loan_disburse', entity: 'Loan', entityId: { in: loans.map(l => l.id) } },
      select: { entityId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    for (const e of entries) if (e.entityId) disbursedAtByLoan.set(e.entityId, e.createdAt)
  }

  const totalDisbursed = loans.length
  const totalDisbursedAmount = loans.reduce((s, l) => s + l.principal, 0)
  let totalOutstanding = 0
  let overdueCount = 0

  const list = loans.map(l => {
    const repaid = l.repayments.reduce((s, r) => s + r.amount, 0)
    const outstanding = Math.max(0, l.totalAmount - repaid)
    totalOutstanding += outstanding
    if (l.dueDate < now && outstanding > 0) overdueCount++

    return {
      id: l.id,
      ref: l.ref,
      principal: l.principal,
      totalAmount: l.totalAmount,
      interestRate: l.interestRate,
      durationDays: l.durationDays,
      dueDate: l.dueDate,
      customerName: `${l.customer.firstName} ${l.customer.lastName}`,
      customerId: l.customer.customerId,
      agentName: l.agent.name,
      agentId: l.agent.agentId,
      createdAt: l.createdAt,
      disbursedAt: disbursedAtByLoan.get(l.id) ?? null,
      approvedBy: l.approvedBy,
      outstanding,
      isOverdue: l.dueDate < now && outstanding > 0,
    }
  })

  return NextResponse.json({ loans: list, totalDisbursed, totalDisbursedAmount, totalOutstanding, overdueCount })
}
