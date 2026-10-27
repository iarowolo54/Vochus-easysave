import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { redemptionDeduction, planHasCashDeposit } from '@/lib/wallet-rates'
import { money } from '@/lib/wallet-guard'

function genRef() {
  return `ER-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`
}

export async function GET() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const records = await prisma.earlyRedemption.findMany({
    include: {
      savingsPlan: {
        include: {
          customer: {
            select: {
              customerId: true, firstName: true, lastName: true,
              agent: { select: { name: true, agentId: true } },
            },
          },
        },
      },
    },
    orderBy: { requestedAt: 'desc' },
  })

  const pending = records.filter(r => ['Pending', 'TokenValidated', 'AgentApproved'].includes(r.status)).length
  const approved = records.filter(r => r.status === 'Approved').length
  const rejected = records.filter(r => r.status === 'Rejected').length
  const tokensToday = records.filter(r => {
    if (!r.token) return false
    const issued = new Date(r.requestedAt)
    const today = new Date()
    return issued.toDateString() === today.toDateString()
  }).length

  return NextResponse.json({
    pending, approved, rejected, tokensToday,
    records: records.map(r => ({
      id: r.id,
      ref: r.ref,
      type: r.type,
      reason: r.reason,
      note: r.note,
      status: r.status,
      balance: r.balance,
      penalty: r.penalty,
      netPayout: r.netPayout,
      token: r.token,
      tokenExpiry: r.tokenExpiry,
      payoutMethod: r.payoutMethod,
      accountNumber: r.accountNumber,
      accountName: r.accountName,
      bankName: r.bankName,
      bankTransferStatus: r.bankTransferStatus,
      requestedAt: r.requestedAt,
      decidedAt: r.decidedAt,
      decidedBy: r.decidedBy,
      customerName: `${r.savingsPlan.customer.firstName} ${r.savingsPlan.customer.lastName}`,
      customerId: r.savingsPlan.customer.customerId,
      agentName: r.savingsPlan.customer.agent.name,
      agentId: r.savingsPlan.customer.agent.agentId,
      savingsPlanId: r.savingsPlanId,
      planStatus: r.savingsPlan.status,
    })),
  })
}

export async function POST(req: Request) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { savingsPlanId, type, reason, note, payoutMethod } = await req.json()
  if (!savingsPlanId || !reason) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const plan = await prisma.savingsPlan.findUnique({ where: { id: savingsPlanId } })
  if (!plan) return NextResponse.json({ error: 'Savings plan not found' }, { status: 404 })

  const isEarly = type === 'early' || plan.status === 'Active'
  const gross = money(plan.balance)
  const hasCashDeposit = await planHasCashDeposit(prisma, plan.id)
  const rates = redemptionDeduction({ balance: plan.balance, dailyAmount: plan.dailyAmount, cadence: plan.cadence, hasCashDeposit, periodDays: plan.periodDays, initiator: 'admin', source: (plan as any).source })
  const deduction = money(rates.total)
  const netPayout = money(gross - deduction)

  const record = await prisma.earlyRedemption.create({
    data: {
      ref: genRef(),
      savingsPlanId,
      type: isEarly ? 'early' : 'matured',
      reason,
      note: note || null,
      status: 'Pending',
      balance: gross,
      penalty: deduction,
      netPayout,
    },
  })

  return NextResponse.json({ id: record.id, ref: record.ref, gross, deduction, netPayout })
}
