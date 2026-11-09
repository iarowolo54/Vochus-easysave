import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { maxSinglePayment, overCapMessage } from '@/lib/payment-cap'
import { logAudit } from '@/lib/audit'
import { createPaymentIntent } from '@/lib/payment-intent'
import { planHasEnded, PLAN_ENDED } from '@/lib/plan-credit'
import { hasOpenRedemption } from '@/lib/redemption-balance'
import { PAYSTACK_ENABLED, paystackOff } from '@/lib/paystack-off'
import { CARD_NOT_IN_USE, getFundingMode } from '@/lib/funding-mode'
import { getFlexibleSettings, isFlexible } from '@/lib/flexible-savings'
import { periodPaidError } from '@/lib/bulk-savings'

export async function POST(req: NextRequest) {
  // Paystack is closed (see src/lib/paystack-off.ts): nothing may start a card payment.
  if (!PAYSTACK_ENABLED) return paystackOff()
  // Super admin chose bank transfer for customers (Payouts & top-ups): no new card payments.
  if ((await getFundingMode(prisma)).customer !== 'card') return NextResponse.json({ error: CARD_NOT_IN_USE }, { status: 410 })
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const plan = await prisma.savingsPlan.findFirst({
    where: { customerId: customer.id, status: 'Active', maturityDate: { gt: new Date() } },
    orderBy: { startDate: 'desc' },
  })
  if (!plan) return NextResponse.json({ error: 'No active savings plan' }, { status: 400 })

  const body = await req.json()

  if (body.planId) {
    const targetPlan = await prisma.savingsPlan.findFirst({
      where: { id: body.planId, customerId: customer.id, status: 'Active' },
    })
    if (!targetPlan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    Object.assign(plan, targetPlan)
  }

  if (planHasEnded(plan)) return NextResponse.json({ error: PLAN_ENDED }, { status: 409 })

  if (await hasOpenRedemption(prisma, plan.id)) {
    return NextResponse.json({ error: 'You’ve asked to redeem from this plan. You can’t add money until that request is finished.' }, { status: 409 })
  }

  // Flexible plans have no set amount, so the person must say how much (never the plan's ₦0 daily amount).
  if (isFlexible(plan.cadence) && (body.amount === undefined || body.amount === null || body.amount === '')) {
    return NextResponse.json({ error: 'Enter how much you want to save.' }, { status: 400 })
  }
  const amount = parseFloat(body.amount ?? plan.dailyAmount)
  const minimum = isFlexible(plan.cadence) ? Math.max(100, (await getFlexibleSettings(prisma)).minDeposit) : 100
  if (!amount || amount < minimum) return NextResponse.json({ error: `Minimum ₦${minimum.toLocaleString('en-NG')}` }, { status: 400 })
  // One payment can't be more than the plan's amount for the days it has left (owner's rule).
  const max = maxSinglePayment(plan)
  if (max !== null && amount > max) return NextResponse.json({ error: overCapMessage(max) }, { status: 400 })
  const paid = await periodPaidError(prisma, plan, new Date())
  if (paid) return NextResponse.json({ error: paid }, { status: 409 })

  const email = customer.email ?? `${customer.customerId.toLowerCase()}@vochus.ng`
  const rand = randomBytes(9).toString('base64url').toUpperCase()
  const ref = `VCHS-CST-${customer.customerId}-${Date.now()}-${rand}`

  // Written first, as auto-debit/init does: a payment the webhook sees must find its intent, and a charge with no
  // intent is never credited. If Paystack refuses or can't be reached, nothing was started, so take it back.
  await createPaymentIntent({ ref, actorType: 'customer', customerId: customer.id, planId: plan.id, amount })
  const abandon = () => prisma.paymentIntent.deleteMany({ where: { ref } })

  let data: { status?: boolean; message?: string; data?: { reference: string; authorization_url: string } }
  try {
    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: Math.round(amount * 100),
        reference: ref,
        callback_url: `${process.env.NEXTAUTH_URL}/customer/save/callback`,
        metadata: {
          customerId: customer.id,
          customerCode: customer.customerId,
          planId: plan.id,
          amount,
        },
      }),
    })
    data = await res.json()
  } catch {
    await abandon()
    return NextResponse.json({ error: 'We couldn’t reach Paystack. Please try again.' }, { status: 502 })
  }
  if (!data.status || !data.data) {
    await abandon()
    return NextResponse.json({ error: data.message ?? 'Paystack init failed' }, { status: 502 })
  }

  logAudit({
    action: 'payment_initiated',
    entity: 'Transaction',
    details: `${customer.firstName} ${customer.lastName} (${customer.customerId}) initiated Paystack payment of ₦${amount.toLocaleString()} — ref ${ref} — plan ${plan.id} (${plan.goal})`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: `${customer.firstName} ${customer.lastName}`,
  })

  return NextResponse.json({ reference: data.data.reference, authorizationUrl: data.data.authorization_url, amount })
}
