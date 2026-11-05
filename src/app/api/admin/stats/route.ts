import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { depositPeriodStarts, summariseDeposits } from '@/lib/deposit-periods'

export async function GET() {
  const guard = await requireAdminArea()
  if (!guard.ok) return guard.response

  const [
    totalAgents,
    totalCustomers,
    savingsPlans,
    activeLoans,
    pendingLoans,
    pendingRedemptions,
    depositRows,
  ] = await Promise.all([
    prisma.agent.count(),
    prisma.customer.count(),
    prisma.savingsPlan.findMany({ select: { balance: true } }),
    prisma.loan.findMany({ where: { status: 'Disbursed' }, select: { principal: true } }),
    prisma.loan.count({ where: { status: 'Pending' } }),
    prisma.transaction.count({ where: { type: 'redemption', status: 'Pending' } }),
    // Only two small columns, from the start of last month: enough for the periods and the month chart.
    prisma.transaction.findMany({
      where: { type: 'saving', status: 'Done', createdAt: { gte: depositPeriodStarts().prevMonth } },
      select: { createdAt: true, amount: true, feeTaken: true },
    }),
  ])

  const totalSavingsPool = savingsPlans.reduce((s, p) => s + p.balance, 0)
  const activeLoansPortfolio = activeLoans.reduce((s, l) => s + l.principal, 0)

  return NextResponse.json({
    totalAgents,
    totalCustomers,
    totalSavingsPool,
    activeLoans: activeLoans.length,
    activeLoansPortfolio,
    pendingLoans,
    pendingRedemptions,
    deposits: summariseDeposits(depositRows),
  })
}
