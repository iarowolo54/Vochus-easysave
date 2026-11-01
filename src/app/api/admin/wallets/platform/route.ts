import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const guard = await requirePermission('money')
  if (!guard.ok) return guard.response
  const session = guard.session

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [wallets, agents, savingsAgg, todayTxns] = await Promise.all([
    prisma.platformWallet.findMany({ orderBy: { type: 'asc' } }),
    prisma.agent.findMany({ select: { walletBalance: true, commissionBalance: true } }),
    prisma.savingsPlan.aggregate({ where: { status: 'Active' }, _sum: { balance: true } }),
    prisma.transaction.findMany({
      where: { createdAt: { gte: todayStart } },
      select: { type: true, amount: true },
    }),
  ])

  const totalAgentFloat = agents.reduce((s, a) => s + a.walletBalance, 0)
  const totalAgentCommission = agents.reduce((s, a) => s + a.commissionBalance, 0)
  const totalCustomerSavings = savingsAgg._sum.balance ?? 0

  const today = {
    savings: todayTxns.filter(t => t.type === 'saving').reduce((s, t) => s + t.amount, 0),
    redemptions: todayTxns.filter(t => t.type === 'redemption').reduce((s, t) => s + t.amount, 0),
    registrations: todayTxns.filter(t => t.type === 'registration').length,
    walletFunding: todayTxns.filter(t => t.type === 'wallet_funding').reduce((s, t) => s + t.amount, 0),
    disbursements: todayTxns.filter(t => t.type === 'disbursement').reduce((s, t) => s + t.amount, 0),
    repayments: todayTxns.filter(t => t.type === 'repayment').reduce((s, t) => s + t.amount, 0),
  }

  return NextResponse.json({
    wallets,
    totalAgentFloat,
    totalAgentCommission,
    totalCustomerSavings,
    today,
  })
}
