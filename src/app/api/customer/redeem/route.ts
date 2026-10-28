import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { redemptionDeduction, planHasCashDeposit } from '@/lib/wallet-rates'
import { money } from '@/lib/wallet-guard'
import { resolveAccount } from '@/lib/paystack'
import { sendSMS } from '@/lib/kudisms'
import { sendMail } from '@/lib/mail'
import crypto from 'crypto'
import { hashRedemptionToken, redemptionTokenMatches } from '@/lib/redemption-token'

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
  // Never expose the confirmation code (or its expiry) via a read path — it is
  // delivered out-of-band (SMS/email) and only ever submitted back via PATCH.
  const safeRedemptions = redemptions.map(({ token, tokenExpiry, ...r }) => r)

  const hasCashDeposit = await planHasCashDeposit(prisma, plan.id)
  return NextResponse.json({ plan: { ...plan, hasCashDeposit }, redemptions: safeRedemptions })
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

  // Verify the bank account server-side and store the RESOLVED name, so a payout
  // can't be redirected via a spoofed account name (finding #5).
  let resolvedAccountName: string | null = accountName || null
  if (payoutMethod === 'BankTransfer') {
    if (!accountNumber || !bankCode) {
      return NextResponse.json({ error: 'Bank code and account number are required' }, { status: 400 })
    }
    try {
      const resolved = await resolveAccount(String(accountNumber), String(bankCode))
      resolvedAccountName = resolved.accountName
    } catch {
      return NextResponse.json({ error: 'Could not verify that bank account. Check the account number and bank.' }, { status: 400 })
    }
  }

  const hasCashDeposit = await planHasCashDeposit(prisma, plan.id)
  const rates = redemptionDeduction({ balance: plan.balance, dailyAmount: plan.dailyAmount, cadence: plan.cadence, hasCashDeposit, initiator: 'customer', source: (plan as any).source })
  const deduction = money(rates.total)
  const netPayout = money(plan.balance - deduction)

  // Crypto-random token (finding #6 — not Math.random).
  const token = crypto.randomInt(100000, 1000000).toString()
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
      token: hashRedemptionToken(token),
      tokenExpiry,
      payoutMethod,
      accountNumber: accountNumber || null,
      accountName: resolvedAccountName,
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

  // Deliver the confirmation code to the customer's OWN registered phone (and
  // email if on file) — it is never returned in the response or logged, so the
  // confirmation step proves possession of the registered contact, not just
  // that the customer can read their own screen. sendSMS is a no-op off-prod.
  const expiryStr = tokenExpiry.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  sendSMS(customer.phone, `Vochus Easy Save: your redemption confirmation code is ${token}. It expires ${expiryStr}. Do not share it.`).catch(() => {})
  if (customer.email) {
    sendMail({
      to: customer.email,
      subject: 'Your Vochus Easy Save redemption code',
      html: `<p>Hi ${customer.firstName},</p><p>Your redemption confirmation code is:</p><p style="font-size:32px;font-weight:800;letter-spacing:8px;font-family:monospace">${token}</p><p>It expires ${expiryStr}. Do not share this code with anyone.</p>`,
    }).catch(() => {})
  }

  return NextResponse.json({ ref: redemption.ref, isEarly, deduction, netPayout, balance: plan.balance })
}

export async function PATCH(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ref, token } = await req.json()
  if (!ref || !token) return NextResponse.json({ error: 'Missing ref or token' }, { status: 400 })

  const redemption = await prisma.earlyRedemption.findUnique({
    where: { ref },
    include: { savingsPlan: { select: { customer: { select: { id: true } } } } },
  })
  // Ownership: a customer may only validate their OWN redemption's token (finding #6).
  if (!redemption || redemption.savingsPlan.customer.id !== session.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (redemption.status !== 'Pending') return NextResponse.json({ error: 'Already processed' }, { status: 409 })

  if (!redemptionTokenMatches(redemption.token, token)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  if (!redemption.tokenExpiry || redemption.tokenExpiry < new Date()) {
    return NextResponse.json({ error: 'Token expired' }, { status: 400 })
  }

  await prisma.earlyRedemption.update({
    where: { ref },
    data: { status: 'TokenValidated' },
  })

  return NextResponse.json({ ok: true, message: 'Token validated. Awaiting agent approval.' })
}
