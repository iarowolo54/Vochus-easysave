import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
