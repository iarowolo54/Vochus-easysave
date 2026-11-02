import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { createPaymentIntent } from '@/lib/payment-intent'
import { hasOpenRedemption } from '@/lib/redemption-balance'

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const plan = await prisma.savingsPlan.findFirst({
    where: { customerId: customer.id, status: 'Active' },
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

  if (await hasOpenRedemption(prisma, plan.id)) {
    return NextResponse.json({ error: 'You’ve asked to collect from this plan. You can’t add money until that request is finished.' }, { status: 409 })
  }

  const amount = parseFloat(body.amount ?? plan.dailyAmount)
  if (!amount || amount < 100) return NextResponse.json({ error: 'Minimum ₦100' }, { status: 400 })

  const email = customer.email ?? `${customer.customerId.toLowerCase()}@vochus.ng`
  const rand = randomBytes(9).toString('base64url').toUpperCase()
  const ref = `VCHS-CST-${customer.customerId}-${Date.now()}-${rand}`

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

  const data = await res.json()
  if (!data.status) return NextResponse.json({ error: data.message ?? 'Paystack init failed' }, { status: 502 })

  // Bind this reference to the customer + plan + amount server-side; verify requires it.
  await createPaymentIntent({ ref, actorType: 'customer', customerId: customer.id, planId: plan.id, amount })

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
