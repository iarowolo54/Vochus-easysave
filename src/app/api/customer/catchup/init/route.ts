import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { createPaymentIntent } from '@/lib/payment-intent'
import { buildSlotsWat, dayDeposits } from '@/lib/savings-card'
import { isEligiblePlan, validateSelection } from '@/lib/catchup'
import { inFlightKeys } from '@/lib/pay-ahead'

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

  if (!isEligiblePlan(plan)) return NextResponse.json({ error: 'Plan is not eligible for catch-up' }, { status: 400 })

  // Build the plan's live slots from its actual deposits + existing coverage.
  const [deposits, coverage] = await Promise.all([
    prisma.transaction.findMany({ where: { planId: plan.id, type: 'saving', status: 'Done' }, select: { createdAt: true, ref: true } }),
    prisma.planDayCoverage.findMany({ where: { savingsPlanId: plan.id }, select: { coversKey: true, ref: true } }),
  ])
  const slots = buildSlotsWat(
    { startDate: plan.startDate.toISOString(), maturityDate: plan.maturityDate.toISOString(), periodDays: plan.periodDays, cadence: plan.cadence },
    dayDeposits(deposits, coverage.map(c => c.ref)).map(d => d.createdAt.toISOString()),
    coverage.map(c => c.coversKey),
  )

  const result = validateSelection(plan, slots, keys)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  const amount = result.total

  // A day auto-debit is charging right now would otherwise be paid for twice.
  const processing = await prisma.autoDebitAttempt.findMany({
    where: { savingsPlanId: plan.id, status: 'processing' },
    select: { cycleDate: true },
  })
  const charging = new Set(inFlightKeys(plan, processing))
  if (keys.some(k => charging.has(k))) {
    return NextResponse.json({ error: 'Your card is being charged for one of these days. Remove it, or try again shortly.' }, { status: 409 })
  }

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
