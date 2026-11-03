import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { redemptionDeduction, planHasCashDeposit } from '@/lib/wallet-rates'
import { money } from '@/lib/wallet-guard'
import { excludeExpiredPending, IN_FLIGHT_REDEMPTION_STATUSES } from '@/lib/redemption-statuses'
import { balanceUnchanged, readyToFinalize } from '@/lib/redemption-balance'
import { heldForNameCheck } from '@/lib/payout-account'

// Awaiting admin action = in flight but not yet Approved (incl. AwaitingOTP / Finalizing), or a transfer
// whose outcome the admin needs to check (Processing).
const AWAITING_ACTION_STATUSES = [...IN_FLIGHT_REDEMPTION_STATUSES.filter(s => s !== 'Approved'), 'Processing']
const DECIDABLE_STATUSES = ['Pending', 'TokenValidated', 'AgentApproved']

/** Whether approving, or entering the Paystack code, would now be refused because money moved. */
function balanceChanged(r: { status: string; balance: number; savingsPlan: { status: string; balance: number } }) {
  if (r.status === 'AwaitingOTP') return !readyToFinalize(r.savingsPlan, r.balance)
  return DECIDABLE_STATUSES.includes(r.status) && !balanceUnchanged(r.savingsPlan.balance, r.balance)
}

function genRef() {
  return `ER-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`
}

export async function GET() {
  const guard = await requirePermission('customers')
  if (!guard.ok) return guard.response
  const session = guard.session

  const records = await prisma.earlyRedemption.findMany({
    include: {
      savingsPlan: {
        include: {
          customer: {
            select: {
              id: true, customerId: true, firstName: true, lastName: true, phone: true,
              agent: { select: { name: true, agentId: true, status: true } },
            },
          },
        },
      },
    },
    orderBy: { requestedAt: 'desc' },
  })

  const now = new Date()

  // The redeemer's full plan list is only shown in the detail of an actionable record, so fetch it
  // once for just those customers (not joined onto every historical row). id is used server-side only.
  const actionableCustomerIds = [
    ...new Set(records.filter(r => AWAITING_ACTION_STATUSES.includes(r.status)).map(r => r.savingsPlan.customer.id)),
  ]
  const customerPlans = actionableCustomerIds.length
    ? await prisma.savingsPlan.findMany({
        where: { customerId: { in: actionableCustomerIds } },
        select: { id: true, customerId: true, goal: true, balance: true, status: true, startDate: true, maturityDate: true },
        orderBy: { startDate: 'desc' },
      })
    : []
  const plansByCustomer = new Map<string, { id: string; goal: string; balance: number; status: string; startDate: Date; maturityDate: Date }[]>()
  for (const p of customerPlans) {
    const { customerId, ...plan } = p
    const list = plansByCustomer.get(customerId) ?? []
    list.push(plan)
    plansByCustomer.set(customerId, list)
  }

  const pending = records.filter(r => AWAITING_ACTION_STATUSES.includes(r.status)).length
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
      isEarly: now < r.savingsPlan.maturityDate,
      reason: r.reason,
      note: r.note,
      status: r.status,
      balance: r.balance,
      currentBalance: r.savingsPlan.balance,
      balanceChanged: balanceChanged(r),
      // Paid, but money that arrived during the payout is still on the closed plan.
      needsReview: r.status === 'Approved' && r.savingsPlan.status === 'Redeemed' && r.savingsPlan.balance > 0.005,
      penalty: r.penalty,
      netPayout: r.netPayout,
      // token intentionally omitted: it is a hash of a 6-digit code (low
      // offline brute-force cost) and staff never need it. The customer gets
      // the code out-of-band; agents validate it via verify-token.
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
      customerPhone: r.savingsPlan.customer.phone,
      agentName: r.savingsPlan.customer.agent.name,
      agentId: r.savingsPlan.customer.agent.agentId,
      agentActive: r.savingsPlan.customer.agent.status === 'Active',
      nameMismatch: heldForNameCheck(r, r.savingsPlan.customer),
      savingsPlanId: r.savingsPlanId,
      planStatus: r.savingsPlan.status,
      // The plan being redeemed.
      planGoal: r.savingsPlan.goal,
      planStartDate: r.savingsPlan.startDate,
      planMaturityDate: r.savingsPlan.maturityDate,
      // Every savings plan this redeemer holds (the one being redeemed is flagged by id === savingsPlanId);
      // present only for actionable records (the detail modal's "All savings plans" section).
      customerPlans: plansByCustomer.get(r.savingsPlan.customer.id),
    })),
  })
}

export async function POST(req: Request) {
  const guard = await requirePermission('customers')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { savingsPlanId, type, reason, note, payoutMethod } = await req.json()
  if (!savingsPlanId || !reason) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const plan = await prisma.savingsPlan.findUnique({ where: { id: savingsPlanId } })
  if (!plan) return NextResponse.json({ error: 'Savings plan not found' }, { status: 404 })

  const existing = await prisma.earlyRedemption.findFirst({
    where: { savingsPlanId, status: { in: [...IN_FLIGHT_REDEMPTION_STATUSES, 'Processing'] }, ...excludeExpiredPending() },
    select: { id: true },
  })
  if (existing) return NextResponse.json({ error: 'This plan already has a request in progress' }, { status: 409 })

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
