import { NextRequest, NextResponse } from 'next/server'
import { requireAdminArea, requirePermission } from '@/lib/admin-guard'
import type { ScreenKey } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { buildAnalytics } from '@/lib/analytics'

const RANGES = [7, 30, 90]
const DAY_MS = 86_400_000

export async function GET(req: NextRequest) {
  const area = await requireAdminArea()
  if (!area.ok) return area.response

  // Each block of the page needs the same permission as the screen it summarises; a block the actor lacks is left out.
  const allowed = async (screen: ScreenKey) => (await requirePermission(screen, 'view')).ok
  const [money, commission, agentsOk, loansOk, customersOk] = await Promise.all(
    (['transactions', 'commission', 'agents', 'loans', 'customers'] as const).map(allowed),
  )
  if (!(money || commission || agentsOk || loansOk || customersOk)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const asked = Number(new URL(req.url).searchParams.get('days'))
  const days = RANGES.includes(asked) ? asked : 30
  const now = new Date()
  // Two periods back (this one and the one before it, for the comparison); sign-ups need one.
  const since = new Date(now.getTime() - 2 * days * DAY_MS - DAY_MS)
  const signupsSince = new Date(now.getTime() - days * DAY_MS - DAY_MS)
  const none = Promise.resolve([] as never[])

  const [deposits, customers, agentSignups, activePlans, ledger, activeAgents, loans, redemptions, disbursements, withdrawals] = await Promise.all([
    money || agentsOk
      ? prisma.transaction.findMany({
          where: { type: 'saving', status: 'Done', createdAt: { gte: since } },
          select: { createdAt: true, amount: true, feeTaken: true, customerId: true, planId: true, agentId: true },
        })
      : none,
    customersOk ? prisma.customer.findMany({ where: { createdAt: { gte: signupsSince } }, select: { createdAt: true } }) : none,
    customersOk ? prisma.agent.findMany({ where: { createdAt: { gte: signupsSince } }, select: { createdAt: true } }) : none,
    money ? prisma.savingsPlan.findMany({ where: { status: 'Active' }, select: { id: true, startDate: true, source: true } }) : none,
    commission ? prisma.commissionLedger.findMany({ where: { createdAt: { gte: since } }, select: { party: true, source: true, amount: true, createdAt: true } }) : none,
    agentsOk ? prisma.agent.findMany({ where: { status: 'Active' }, select: { id: true, agentId: true, name: true, createdAt: true } }) : none,
    loansOk
      ? prisma.loan.findMany({ select: { status: true, principal: true, totalAmount: true, dueDate: true, repayments: { select: { amount: true } } } })
      : none,
    money ? prisma.transaction.findMany({ where: { type: 'redemption', status: 'Done', createdAt: { gte: since } }, select: { amount: true, createdAt: true } }) : none,
    money ? prisma.transaction.findMany({ where: { type: 'disbursement', status: 'Done', createdAt: { gte: since } }, select: { amount: true, createdAt: true } }) : none,
    money ? prisma.agentWithdrawal.findMany({ where: { status: 'Approved', decidedAt: { gte: since } }, select: { amount: true, decidedAt: true } }) : none,
  ])

  const r = buildAnalytics({
    deposits,
    customerDates: customers.map(c => c.createdAt),
    agentDates: agentSignups.map(a => a.createdAt),
    activePlans,
    ledger,
    activeAgents,
    loans: loans.map(l => ({ status: l.status, principal: l.principal, totalAmount: l.totalAmount, dueDate: l.dueDate, repaid: l.repayments.reduce((s, x) => s + x.amount, 0) })),
    outflows: [
      ...redemptions.map(x => ({ kind: 'redemption' as const, amount: x.amount, at: x.createdAt })),
      ...disbursements.map(x => ({ kind: 'loan' as const, amount: x.amount, at: x.createdAt })),
      ...withdrawals.filter(x => x.decidedAt).map(x => ({ kind: 'withdrawal' as const, amount: x.amount, at: x.decidedAt as Date })),
    ],
    days,
    now,
  })

  const { earnings, topAgents, idleAgents, loans: loanBook, out, deposits: dep, savers, plansBySource, growth, buckets, ...rest } = r
  return NextResponse.json({
    ...rest,
    buckets,
    can: { money, commission, agents: agentsOk, loans: loansOk, customers: customersOk },
    ...(money && { deposits: dep, savers, plansBySource, out }),
    ...(commission && { earnings }),
    ...(agentsOk && { topAgents, idleAgents }),
    ...(loansOk && { loans: loanBook }),
    ...(customersOk && { growth }),
  })
}
