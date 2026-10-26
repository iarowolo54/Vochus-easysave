import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(adminAuthOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      approvedBy: l.approvedBy,
      outstanding,
      isOverdue: l.dueDate < now && outstanding > 0,
    }
  })

  return NextResponse.json({ loans: list, totalDisbursed, totalDisbursedAmount, totalOutstanding, overdueCount })
}
