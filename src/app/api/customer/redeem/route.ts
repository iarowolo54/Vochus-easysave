import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { redemptionDeduction, planHasCashDeposit } from '@/lib/wallet-rates'
import { money } from '@/lib/wallet-guard'
import crypto from 'crypto'

export async function GET() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const plan = await prisma.savingsPlan.findFirst({
    where: { customerId: customer.id, status: 'Active' },
    orderBy: { startDate: 'desc' },
  })
  if (!plan) return NextResponse.json({ plan: null, redemptions: [] })

  const redemptions = await prisma.earlyRedemption.findMany({
    where: { savingsPlanId: plan.id },
    orderBy: { requestedAt: 'desc' },
  })

  const hasCashDeposit = await planHasCashDeposit(prisma, plan.id)
  return NextResponse.json({ plan: { ...plan, hasCashDeposit }, redemptions })
}

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const plan = await prisma.savingsPlan.findFirst({
    where: { customerId: customer.id, status: 'Active' },
    orderBy: { startDate: 'desc' },
  })
  if (!plan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })
  if (plan.balance <= 0) return NextResponse.json({ error: 'No balance to redeem' }, { status: 400 })

  const pending = await prisma.earlyRedemption.findFirst({
    where: { savingsPlanId: plan.id, status: { in: ['Pending', 'TokenValidated', 'AgentApproved'] } },
  })
  if (pending) return NextResponse.json({ error: 'You already have a pending redemption request' }, { status: 409 })

  const body = await req.json()
  const { reason, accountNumber, accountName, bankCode, bankName } = body

  if (!reason) return NextResponse.json({ error: 'Reason required' }, { status: 400 })

  const now = new Date()
  const isEarly = now < plan.maturityDate
  const payoutMethod = accountNumber ? 'BankTransfer' : 'Cash'
  const hasCashDeposit = await planHasCashDeposit(prisma, plan.id)
  const rates = redemptionDeduction({ balance: plan.balance, dailyAmount: plan.dailyAmount, cadence: plan.cadence, hasCashDeposit, initiator: 'customer', source: (plan as any).source })
  const deduction = money(rates.total)
  const netPayout = money(plan.balance - deduction)

  const token = String(Math.floor(100000 + Math.random() * 900000))
  const tokenExpiry = new Date(now.getTime() + 30 * 60 * 1000)
  const ref = `RED-${customer.customerId}-${Date.now()}`

  const redemption = await prisma.earlyRedemption.create({
    data: {
      ref,
      savingsPlanId: plan.id,
      type: isEarly ? 'early' : 'maturity',
      reason,
      status: 'Pending',
      balance: plan.balance,
      penalty: deduction,
      netPayout,
      token,
      tokenExpiry,
      payoutMethod,
      accountNumber: accountNumber || null,
      accountName: accountName || null,
      bankCode: bankCode || null,
      bankName: bankName || null,
    },
  })

  logAudit({
    action: 'customer_redeem',
    entity: 'EarlyRedemption',
    entityId: redemption.id,
    details: `Customer ${customer.firstName} ${customer.lastName} (${customer.customerId}) requested ${isEarly ? 'early' : 'maturity'} redemption ${redemption.ref} — balance ₦${plan.balance}, deduction ₦${deduction}, payout ₦${netPayout}`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: `${customer.firstName} ${customer.lastName}`,
  })

  return NextResponse.json({ ref: redemption.ref, token, isEarly, deduction, netPayout, balance: plan.balance })
}

export async function PATCH(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ref, token } = await req.json()
  if (!ref || !token) return NextResponse.json({ error: 'Missing ref or token' }, { status: 400 })

  const redemption = await prisma.earlyRedemption.findUnique({ where: { ref } })
  if (!redemption) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (redemption.status !== 'Pending') return NextResponse.json({ error: 'Already processed' }, { status: 409 })

  if (redemption.token !== token) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  if (!redemption.tokenExpiry || redemption.tokenExpiry < new Date()) {
    return NextResponse.json({ error: 'Token expired' }, { status: 400 })
  }

  await prisma.earlyRedemption.update({
    where: { ref },
    data: { status: 'TokenValidated' },
  })

  return NextResponse.json({ ok: true, message: 'Token validated. Awaiting agent approval.' })
}
