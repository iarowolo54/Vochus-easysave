import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { createPaymentIntent } from '@/lib/payment-intent'
import { checkBulkSelection } from '@/lib/bulk-savings'

// Bulk Savings: a customer pays for missed, today's or upcoming days on their own
// self-service plan. The server validates the selected day-keys against the
// plan's live slots (in WAT, where the customer's calendar is) and computes the
// amount from the plan rate — the client amount is never trusted. The ref deliberately reuses the VCHS-CST- style so
// /customer/save/callback routes it to the normal paystack/verify handler.
export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { planId?: unknown; keys?: unknown }
  const planId = typeof body.planId === 'string' ? body.planId : null
  const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === 'string') : []
  if (!planId) return NextResponse.json({ error: 'Missing planId' }, { status: 400 })

  // Own-the-data: only the session customer's plan.
  const plan = await prisma.savingsPlan.findFirst({ where: { id: planId, customerId: customer.id } })
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const check = await checkBulkSelection(prisma, plan, keys, new Date())
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status })
  const amount = check.total

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
        catchup: true,
        coversKeys: keys,
      },
    }),
  })

  const data = await res.json()
  if (!data.status) return NextResponse.json({ error: data.message ?? 'Paystack init failed' }, { status: 502 })

  // Bind this reference to the customer + plan + amount + covered days server-side; verify requires it.
  await createPaymentIntent({ ref, actorType: 'customer', customerId: customer.id, planId: plan.id, amount, coversKeys: keys })

  logAudit({
    action: 'catchup_initiated',
    entity: 'Transaction',
    details: `${customer.firstName} ${customer.lastName} (${customer.customerId}) initiated catch-up of ₦${amount.toLocaleString()} for ${keys.length} day(s) — ref ${ref} — plan ${plan.id} (${plan.goal})`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: `${customer.firstName} ${customer.lastName}`,
  })

  return NextResponse.json({ reference: data.data.reference, authorizationUrl: data.data.authorization_url, amount })
}
