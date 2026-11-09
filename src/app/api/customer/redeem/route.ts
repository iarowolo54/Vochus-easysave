import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { excludeExpiredPending, IN_FLIGHT_REDEMPTION_STATUSES, isExpiredPending } from '@/lib/redemption-statuses'
import { logAudit } from '@/lib/audit'
import { redemptionDeduction, planHasCashDeposit } from '@/lib/wallet-rates'
import { collectionFee } from '@/lib/commission-ledger'
import { money } from '@/lib/wallet-guard'
import { accruedInterestForPlan } from '@/lib/savings-interest-plan'
import { bankByCode } from '@/lib/banks'
import { cleanAccountName } from '@/lib/payout-account'
import { sendSMS } from '@/lib/kudisms'
import { sendMail } from '@/lib/mail'
import { collectionCodeChannels } from '@/lib/customer-channels'
import { escapeHtml } from '@/lib/escape-html'
import { redemptionTokenMatches } from '@/lib/redemption-token'
import { createRedemptionWithUniqueCode } from '@/lib/redemption-create'
import { reserveRedemptionAttempt } from '@/lib/redemption-attempts'
import { getPayoutMode } from '@/lib/payout-mode'
import { notifications } from '@/lib/notifications'
import { notifyAgentRedemptionToReview } from '@/lib/payout-notify'

export async function GET(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // A named plan or, with none named, the newest one. Always the customer's own.
  const planId = req.nextUrl.searchParams.get('planId')
  const plan = await prisma.savingsPlan.findFirst({
    where: { customerId: customer.id, status: 'Active', ...(planId ? { id: planId } : {}) },
    orderBy: { startDate: 'desc' },
  })
  if (!plan) return NextResponse.json({ plan: null, redemptions: [] })

  const redemptions = await prisma.earlyRedemption.findMany({
    where: { savingsPlanId: plan.id },
    orderBy: { requestedAt: 'desc' },
  })
  // Never expose the confirmation code (or its expiry) via a read path — it is
  // delivered out-of-band (SMS/email) and only ever submitted back via PATCH.
  const safeRedemptions = redemptions.map(({ token, tokenExpiry, ...r }) => ({ ...r, expired: isExpiredPending({ status: r.status, tokenExpiry }) }))

  const hasCashDeposit = await planHasCashDeposit(prisma, plan.id)
  return NextResponse.json({ plan: { ...plan, hasCashDeposit }, redemptions: safeRedemptions })
}

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  // A named plan or, with none named, the newest one. Always the customer's own.
  const planId = typeof body?.planId === 'string' && body.planId ? body.planId : undefined
  const plan = await prisma.savingsPlan.findFirst({
    where: { customerId: customer.id, status: 'Active', ...(planId ? { id: planId } : {}) },
    orderBy: { startDate: 'desc' },
  })
  if (!plan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })
  if (plan.balance <= 0) return NextResponse.json({ error: 'No balance to redeem' }, { status: 400 })

  const pending = await prisma.earlyRedemption.findFirst({
    where: { savingsPlanId: plan.id, status: { in: IN_FLIGHT_REDEMPTION_STATUSES }, ...excludeExpiredPending() },
  })
  if (pending) return NextResponse.json({ error: 'You already have a pending redemption request' }, { status: 409 })

  const { reason, accountNumber, bankCode } = body

  if (!reason) return NextResponse.json({ error: 'Reason required' }, { status: 400 })

  const now = new Date()
  const isEarly = now < plan.maturityDate
  const payoutMethod = accountNumber ? 'BankTransfer' : 'Cash'
  if (payoutMethod === 'Cash') {
    const agent = await prisma.agent.findUnique({ where: { id: customer.agentId }, select: { status: true } })
    if (agent?.status !== 'Active') {
      return NextResponse.json({ error: 'Cash redemption isn’t available on your account right now. Please choose a bank account instead.' }, { status: 400 })
    }
  }

  // Nothing checks the account with the bank: the bank comes from our list and the name is what the customer typed.
  // Staff compare it with their own bank app before paying.
  let resolvedAccountName: string | null = null
  let resolvedBankName: string | null = null
  if (payoutMethod === 'BankTransfer') {
    const bank = bankByCode(bankCode)
    if (!bank || !/^\d{10}$/.test(String(accountNumber))) {
      return NextResponse.json({ error: 'Choose your bank and enter your 10-digit account number.' }, { status: 400 })
    }
    resolvedAccountName = cleanAccountName(body.accountName)
    if (!resolvedAccountName) return NextResponse.json({ error: 'Enter the account name exactly as it is on the bank account.' }, { status: 400 })
    resolvedBankName = bank.name
  }

  const hasCashDeposit = await planHasCashDeposit(prisma, plan.id)
  const fee = await collectionFee(prisma, { id: plan.id, cadence: plan.cadence, dailyAmount: plan.dailyAmount, source: plan.source, feeCollected: plan.feeCollected, maturityDate: plan.maturityDate }, plan.balance, now)
  const rates = redemptionDeduction({ balance: plan.balance, dailyAmount: plan.dailyAmount, cadence: plan.cadence, hasCashDeposit, initiator: 'customer', source: (plan as any).source })
  const deduction = money(fee.feeRule === 'v2' ? fee.penalty : rates.total)
  const interest = await accruedInterestForPlan(prisma, plan, now)
  const netPayout = money(plan.balance - deduction + interest)

  const tokenExpiry = new Date(now.getTime() + 30 * 60 * 1000)
  const ref = `RED-${customer.customerId}-${Date.now()}`

  // Crypto-random 6-digit code (finding #6 — not Math.random), created
  // collision-safe: retries if the code's hash is already taken (token @unique).
  // notify: collectionRequested
  const { redemption, code: token } = await createRedemptionWithUniqueCode(prisma, (tokenHash) => ({
    ref,
    savingsPlanId: plan.id,
    type: isEarly ? 'early' : 'maturity',
    reason,
    status: 'Pending',
    balance: plan.balance,
    penalty: deduction,
    netPayout,
    feeRule: fee.feeRule,
      feeAgent: fee.feeRule === 'v2' ? fee.feeAgent : 0,
    interestAmount: interest,
    token: tokenHash,
    tokenExpiry,
    payoutMethod,
    accountNumber: payoutMethod === 'BankTransfer' ? String(accountNumber) : null,
    accountName: resolvedAccountName,
    bankCode: payoutMethod === 'BankTransfer' ? String(bankCode) : null,
    bankName: resolvedBankName,
  }), undefined, undefined, r => notifications.collectionRequested({
    id: r.id, customerId: customer.id, agentId: customer.agentId, customerName: `${customer.firstName} ${customer.lastName}`,
    amount: netPayout, byCustomer: true,
  }))

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
  const channels = collectionCodeChannels({ online: plan.source === 'self', email: customer.email, emailVerifiedAt: customer.emailVerifiedAt })
  if (channels.includes('sms')) {
    // sms: collection code — cash customers always; online customers only without a confirmed email
    sendSMS(customer.phone, `Vochus Easy Save: your redemption confirmation code is ${token}. It expires ${expiryStr}. Do not share it.`).catch(() => {})
  }
  if (channels.includes('email') && customer.email) {
    sendMail({
      to: customer.email,
      subject: 'Your Vochus Easy Save redemption code',
      html: `<p>Hi ${escapeHtml(customer.firstName)},</p><p>Your redemption confirmation code is:</p><p style="font-size:32px;font-weight:800;letter-spacing:8px;font-family:monospace">${token}</p><p>It expires ${expiryStr}. Do not share this code with anyone.</p>`,
    }).catch(() => {})
  }

  // Super admins are notified at the admin-approval stage (when the agent approves and
  // sends to admin — see api/agent/redemption/[id]), not at request creation.
  return NextResponse.json({ ref: redemption.ref, isEarly, deduction, interest, netPayout, balance: plan.balance, sentBy: channels })
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

  // Expiry first, so an expired code doesn't burn a guess attempt.
  if (!redemption.tokenExpiry || redemption.tokenExpiry < new Date()) {
    return NextResponse.json({ error: 'Token expired' }, { status: 400 })
  }

  // Cap wrong guesses: reserve an attempt atomically BEFORE comparing, so a
  // hijacked session that doesn't control the customer's phone/email can't
  // brute-force the 6-digit confirmation code. 0 reserved => locked / over cap.
  if (!(await reserveRedemptionAttempt(prisma, ref))) {
    return NextResponse.json(
      { error: 'Too many incorrect attempts. This code is locked — request a new redemption.' },
      { status: 429 },
    )
  }
  if (!redemptionTokenMatches(redemption.token, token)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })

  // notify: none — the customer just confirmed their own code; they were told when they asked, and hear again when it's approved
  await prisma.earlyRedemption.update({
    where: { ref },
    data: { status: 'TokenValidated' },
  })

  // Manual mode: the agent now has something to review. Fully isolated — can never break validation.
  try {
    if ((await getPayoutMode()).customer === 'manual') {
      const cust = await prisma.customer.findUnique({
        where: { id: session.id },
        select: { firstName: true, lastName: true, agent: { select: { email: true, phone: true } } },
      })
      if (cust?.agent) {
        await notifyAgentRedemptionToReview(cust.agent, {
          customerName: `${cust.firstName} ${cust.lastName}`,
          amountNaira: redemption.netPayout,
          ref: redemption.ref,
        })
      }
    }
  } catch {
    /* best-effort */
  }

  return NextResponse.json({ ok: true, message: 'Token validated. Awaiting agent approval.' })
}
