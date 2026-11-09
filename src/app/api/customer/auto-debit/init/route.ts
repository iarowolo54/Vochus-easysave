import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { getCustomerSession } from '@/lib/customer-auth'
import { isFlexible } from '@/lib/flexible-savings'
import { prisma } from '@/lib/prisma'
import { createPaymentIntent } from '@/lib/payment-intent'
import { initCardAuthorization } from '@/lib/paystack'
import { hasOpenRedemption } from '@/lib/redemption-balance'
import { CARD_NOT_IN_USE, getFundingMode } from '@/lib/funding-mode'
import { PAYSTACK_ENABLED, paystackOff } from '@/lib/paystack-off'

// First charge that authorizes the card for future auto-debits (applied to the plan on success).
const FIRST_CHARGE_NAIRA = 50

export async function POST(req: NextRequest) {
  // Paystack is closed (see src/lib/paystack-off.ts): nothing may start a card payment.
  if (!PAYSTACK_ENABLED) return paystackOff()
  // Super admin chose bank transfer for customers (Payouts & top-ups): no new card payments.
  if ((await getFundingMode(prisma)).customer !== 'card') return NextResponse.json({ error: CARD_NOT_IN_USE }, { status: 410 })
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let planId: unknown
  try {
    planId = ((await req.json()) as { planId?: unknown }).planId
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (typeof planId !== 'string' || !planId) {
    return NextResponse.json({ error: 'planId required' }, { status: 400 })
  }

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Owner in the where: another customer's plan is indistinguishable from a missing one.
  const plan = await prisma.savingsPlan.findFirst({
    where: { id: planId, customerId: customer.id, status: 'Active', source: 'self' },
  })
  if (!plan) return NextResponse.json({ error: 'Auto-debit is only available on active online plans' }, { status: 400 })
  if (isFlexible(plan.cadence)) return NextResponse.json({ error: 'Automatic saving isn’t available on flexible plans.' }, { status: 400 })

  if (await hasOpenRedemption(prisma, plan.id)) {
    return NextResponse.json({ error: 'You’ve asked to redeem from this plan. You can’t set up auto-debit until that request is finished.' }, { status: 409 })
  }

  const existing = await prisma.autoDebitMandate.findFirst({
    where: { savingsPlanId: plan.id, status: 'active' },
    select: { id: true },
  })
  if (existing) return NextResponse.json({ error: 'Auto-debit is already active for this plan' }, { status: 409 })

  const baseUrl = process.env.NEXTAUTH_URL
  if (!baseUrl) return NextResponse.json({ error: 'Payment not configured' }, { status: 500 })

  const email = customer.email ?? `${customer.customerId.toLowerCase()}@vochus.ng`
  // `addenroll-` keeps enrollment charges distinct from scheduled `autodebit-` refs.
  const reference = `addenroll-${plan.id}-${randomBytes(9).toString('base64url')}`

  try {
    await createPaymentIntent({
      ref: reference,
      actorType: 'customer',
      customerId: customer.id,
      planId: plan.id,
      amount: FIRST_CHARGE_NAIRA,
    })
    const init = await initCardAuthorization({
      email,
      amountNaira: FIRST_CHARGE_NAIRA,
      reference,
      metadata: { customerId: customer.id, planId: plan.id, purpose: 'auto-debit-enroll' },
      callbackUrl: `${baseUrl}/customer/save/callback`,
    })
    return NextResponse.json({ authorizationUrl: init.authorizationUrl, reference: init.reference })
  } catch {
    return NextResponse.json({ error: 'Could not start card authorization' }, { status: 502 })
  }
}
