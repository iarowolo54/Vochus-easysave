import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response

  const [
    totalAgents,
    totalCustomers,
    savingsPlans,
    activeLoans,
    pendingLoans,
    pendingRedemptions,
  ] = await Promise.all([
    prisma.agent.count(),
    prisma.customer.count(),
    prisma.savingsPlan.findMany({ select: { balance: true } }),
    prisma.loan.findMany({ where: { status: 'Disbursed' }, select: { principal: true } }),
    prisma.loan.count({ where: { status: 'Pending' } }),
    prisma.transaction.count({ where: { type: 'redemption', status: 'Pending' } }),
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
  })
}
