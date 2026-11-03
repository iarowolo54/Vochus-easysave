import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import {
  loanCommission,
  repaymentCommission,
  redemptionCommission,
  sumCommission,
  COMMISSION_SOURCES,
  type CommissionEntry,
  type CommissionSource,
} from '@/lib/commission-history'

const custName = (c: { firstName: string; lastName: string } | null | undefined) =>
  c ? `${c.firstName} ${c.lastName}`.trim() : null

export async function GET(req: NextRequest, context: { params: Promise<{ agentId: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response

  const { agentId } = await context.params
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, name: true, agentId: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const sp = req.nextUrl.searchParams
  const from = sp.get('from') || undefined
  const to = sp.get('to') || undefined
  const DAY = /^\d{4}-\d{2}-\d{2}$/
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) {
    return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 })
  }
  const sourcesParam = (sp.get('sources') || '').split(',').map(s => s.trim()).filter(Boolean)
  const sources = sourcesParam.filter((s): s is CommissionSource => (COMMISSION_SOURCES as readonly string[]).includes(s))
  const want = (s: CommissionSource) => sources.length === 0 || sources.includes(s)

  // Local day boundaries (matches what the drawer sends). Date filters applied in-query.
  const fromDate = from ? new Date(`${from}T00:00:00.000`) : undefined
  const toDate = to ? new Date(`${to}T23:59:59.999`) : undefined
  const createdRange = fromDate || toDate ? { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } : undefined

  const [disbursements, repayments, redemptions, rewards] = await Promise.all([
    want('loan')
      ? prisma.transaction.findMany({
          where: { agentId: agent.id, type: 'disbursement', ...(createdRange && { createdAt: createdRange }) },
          select: { id: true, ref: true, amount: true, status: true, createdAt: true, customerId: true, customer: { select: { firstName: true, lastName: true, customerId: true } } },
        })
      : Promise.resolve([]),
    want('repayment')
      ? prisma.transaction.findMany({
          where: { agentId: agent.id, type: 'repayment', ...(createdRange && { createdAt: createdRange }) },
          select: { id: true, ref: true, amount: true, status: true, createdAt: true, customerId: true, customer: { select: { firstName: true, lastName: true, customerId: true } } },
        })
      : Promise.resolve([]),
    want('redemption')
      ? prisma.earlyRedemption.findMany({
          where: {
            status: 'Approved',
            penalty: { gt: 0 },
            savingsPlan: { customer: { agentId: agent.id } },
            ...(createdRange && { decidedAt: createdRange }),
          },
          select: { id: true, ref: true, penalty: true, status: true, decidedAt: true, requestedAt: true, savingsPlan: { select: { goal: true, customer: { select: { firstName: true, lastName: true, customerId: true } } } } },
        })
      : Promise.resolve([]),
    want('reward')
      ? prisma.agentReward.findMany({
          where: { agentId: agent.id, ...(createdRange && { createdAt: createdRange }) },
          select: { id: true, amount: true, type: true, narration: true, createdAt: true, customer: { select: { firstName: true, lastName: true, customerId: true } } },
        })
      : Promise.resolve([]),
  ])

  const entries: CommissionEntry[] = [
    ...disbursements.map((t): CommissionEntry => ({
      id: `loan:${t.id}`, date: t.createdAt.toISOString(), source: 'loan',
      commission: loanCommission(t.amount), baseAmount: t.amount,
      customerId: t.customer?.customerId ?? null, customerName: custName(t.customer), planGoal: null, ref: t.ref, status: t.status,
    })),
    ...repayments.map((t): CommissionEntry => ({
      id: `repayment:${t.id}`, date: t.createdAt.toISOString(), source: 'repayment',
      commission: repaymentCommission(t.amount), baseAmount: t.amount,
      customerId: t.customer?.customerId ?? null, customerName: custName(t.customer), planGoal: null, ref: t.ref, status: t.status,
    })),
    ...redemptions.map((r): CommissionEntry => ({
      id: `redemption:${r.id}`, date: (r.decidedAt ?? r.requestedAt).toISOString(), source: 'redemption',
      commission: redemptionCommission(r.penalty), baseAmount: r.penalty,
      customerId: r.savingsPlan.customer?.customerId ?? null, customerName: custName(r.savingsPlan.customer), planGoal: r.savingsPlan.goal, ref: r.ref, status: r.status,
    })),
    ...rewards.map((a): CommissionEntry => ({
      id: `reward:${a.id}`, date: a.createdAt.toISOString(), source: 'reward',
      commission: a.amount, baseAmount: a.amount,
      customerId: a.customer?.customerId ?? null, customerName: custName(a.customer), planGoal: null, ref: a.narration || a.type, status: 'Done',
    })),
  ]

  // Source + date filtering already applied in-query; just order newest-first.
  entries.sort((x, y) => y.date.localeCompare(x.date))

  return NextResponse.json({
    agent,
    entries,
    total: sumCommission(entries),
    count: entries.length,
  })
}
