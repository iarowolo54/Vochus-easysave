import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { excludeExpiredPending, IN_FLIGHT_REDEMPTION_STATUSES } from '@/lib/redemption-statuses'
import { sendSMS } from '@/lib/kudisms'
import { sendMail } from '@/lib/mail'
import { createRedemptionWithUniqueCode } from '@/lib/redemption-create'
import { redemptionDeduction, planHasCashDeposit } from '@/lib/wallet-rates'
import { money } from '@/lib/wallet-guard'
import { logAudit } from '@/lib/audit'
import { escapeHtml } from '@/lib/escape-html'
import { listBanks, resolveAccount } from '@/lib/paystack'
import { accountNameMatches, payoutDestination } from '@/lib/payout-account'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const body = await req.json()
    const { planId, customerId, payoutMethod, accountNumber, bankCode } = body
    if (!planId || !customerId) return NextResponse.json({ error: 'Missing fields: planId and customerId required' }, { status: 400 })

    const isBank = payoutMethod === 'Bank Transfer' || payoutMethod === 'BankTransfer'
    if (isBank && (!accountNumber || !bankCode)) {
      return NextResponse.json({ error: 'Bank account details required for Bank Transfer payout' }, { status: 400 })
    }
    if (isBank && (!/^\d{10}$/.test(String(accountNumber)) || !/^\w+$/.test(String(bankCode)))) {
      return NextResponse.json({ error: 'Account numbers have 10 digits. Check the account number and bank.' }, { status: 400 })
    }

    const plan = await prisma.savingsPlan.findFirst({
      where: { id: planId },
      include: { customer: { select: { id: true, firstName: true, lastName: true, agentId: true, phone: true, email: true } } },
    })

    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (plan.customer.id !== customerId) return NextResponse.json({ error: 'Plan does not belong to this customer' }, { status: 400 })
    if (plan.customer.agentId !== agent.id) return NextResponse.json({ error: 'Customer does not belong to this agent' }, { status: 403 })
    if (!['Active', 'Matured'].includes(plan.status)) return NextResponse.json({ error: `Plan status is "${plan.status}" — must be Active or Matured` }, { status: 400 })
    if (plan.balance <= 0) return NextResponse.json({ error: 'No balance to redeem' }, { status: 400 })

    // The account and its name come from Paystack, never the request, and must be the customer's own: the agent
    // chooses where this goes, and the customer's code doesn't check it.
    let resolvedAccountName: string | null = null
    let resolvedBankName: string | null = null
    if (isBank) {
      try {
        const resolved = await resolveAccount(String(accountNumber), String(bankCode))
        if (resolved.accountNumber !== String(accountNumber)) throw new Error('Paystack resolved a different account')
        resolvedAccountName = resolved.accountName
        resolvedBankName = (await listBanks()).find(b => b.code === String(bankCode))?.name ?? null
      } catch {
        return NextResponse.json({ error: 'Could not verify that bank account. Check the account number and bank.' }, { status: 400 })
      }
      if (!resolvedBankName) return NextResponse.json({ error: 'Could not verify that bank account. Check the account number and bank.' }, { status: 400 })
      if (!accountNameMatches(resolvedAccountName, plan.customer)) {
        return NextResponse.json({ error: `This account isn’t in ${plan.customer.firstName} ${plan.customer.lastName}’s name, so it can’t be used. Use an account in the customer’s own name, or pay in cash.` }, { status: 400 })
      }
    }

    const existing = await prisma.earlyRedemption.findFirst({
      where: { savingsPlanId: planId, status: { in: IN_FLIGHT_REDEMPTION_STATUSES }, ...excludeExpiredPending() },
    })
    if (existing) return NextResponse.json({ error: 'A pending redemption request already exists for this customer' }, { status: 409 })

    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const ref = `RDM-${Date.now().toString(36).toUpperCase()}`
    const customerName = `${plan.customer.firstName} ${plan.customer.lastName}`

    const hasCashDeposit = await planHasCashDeposit(prisma, plan.id)
    const rates = redemptionDeduction({ balance: plan.balance, dailyAmount: plan.dailyAmount, cadence: plan.cadence, hasCashDeposit, periodDays: plan.periodDays, initiator: 'admin', source: (plan as any).source })
    const deduction = money(rates.total)
    const netPayout = money(plan.balance - deduction)

    // Collision-safe create: retries if the random code's hash is already taken
    // (token is @unique) instead of 500ing.
    const { code: token } = await createRedemptionWithUniqueCode(prisma, (tokenHash) => ({
      ref,
      savingsPlanId: planId,
      type: 'matured',
      reason: 'Plan matured - customer redemption',
      status: 'Pending',
      balance: plan.balance,
      penalty: deduction,
      netPayout,
      token: tokenHash,
      tokenExpiry,
      payoutMethod: payoutMethod ?? 'Cash',
      accountNumber: isBank ? String(accountNumber) : null,
      accountName: resolvedAccountName,
      bankCode: isBank ? String(bankCode) : null,
      bankName: resolvedBankName,
    }))

    const expiryStr = tokenExpiry.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const destination = isBank && resolvedBankName ? payoutDestination(resolvedBankName, String(accountNumber)) : ''
    const smsBody = `Vochus Easy Save: Your redemption token is ${token}. Present this to your agent to collect N${netPayout.toLocaleString()}. Expires ${expiryStr}.${destination ? ` ${destination}` : ''}`

    // The plaintext token is delivered only out-of-band (SMS/email) — never
    // logged. Only its hash is stored (createRedemptionWithUniqueCode above).
    sendSMS(plan.customer.phone, smsBody).catch(() => {})

    if (plan.customer.email) {
      sendMail({
        to: plan.customer.email,
        subject: 'Your Vochus Easy Save Redemption Token',
        html: `<p>Hi ${plan.customer.firstName},</p><p>Your savings plan has matured. Present the token below to your agent to collect your payout.</p><div style="background:#1a3c2e;border-radius:12px;padding:24px;text-align:center;margin:24px 0"><p style="color:#8fc9a9;font-size:12px;letter-spacing:2px;margin:0 0 8px">REDEMPTION TOKEN</p><p style="color:#4ade80;font-size:48px;font-weight:900;font-family:monospace;letter-spacing:8px;margin:0">${token}</p><p style="color:#8fc9a9;font-size:12px;margin:8px 0 0">Expires: ${expiryStr}</p></div><p>Balance: <strong>N${plan.balance.toLocaleString()}</strong><br/>Deduction: <strong>N${deduction.toLocaleString()}</strong><br/>Payout amount: <strong>N${netPayout.toLocaleString()}</strong></p>${destination ? `<p>${escapeHtml(destination)}</p>` : ''}<p>Ref: <code>${ref}</code></p><p>Do not share this token with anyone other than your registered Vochus agent.</p>`,
      }).catch(() => {})
    }

    logAudit({
      action: 'redemption_requested',
      entity: 'EarlyRedemption',
      details: `Agent ${agent.name} (${agent.agentId}) created redemption request for ${customerName} — plan ${planId}, balance ₦${plan.balance.toLocaleString()}, net payout ₦${netPayout.toLocaleString()}, ref ${ref}`,
      actorType: 'agent',
      actorId: agent.id,
      actorName: agent.name,
    })

    // Super admins are notified at the admin-approval stage (when the agent approves and
    // sends to admin — see api/agent/redemption/[id]), not at request creation.
    return NextResponse.json({ ref, tokenExpiry, balance: plan.balance, deduction, netPayout, customerName, sentTo: { phone: plan.customer.phone, email: plan.customer.email ?? null } })
  } catch (err: any) {
    console.error('[redemption/request]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
