import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEnv } from '@/lib/env'
import { getFlexibleSettings, isFlexible } from '@/lib/flexible-savings'
import { planHasEnded, PLAN_ENDED } from '@/lib/plan-credit'
import { hasOpenRedemption } from '@/lib/redemption-balance'
import { createTransferIntent } from '@/lib/transfer-intent'
import { checkBulkSelection } from '@/lib/bulk-savings'
import { money } from '@/lib/wallet-guard'

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: unknown = await req.json().catch(() => null)
  const input = (body && typeof body === 'object' ? body : {}) as { amount?: unknown; planId?: unknown; keys?: unknown }
  // Paying for chosen days (catch-up): the days decide the amount, and the client's amount is ignored.
  const keys = Array.isArray(input.keys) ? input.keys.filter((k): k is string => typeof k === 'string') : []
  const catchup = keys.length > 0
  let amount = money(Number(input.amount))
  if (!catchup) {
    if (!(amount >= 100)) return NextResponse.json({ error: 'Minimum ₦100' }, { status: 400 })
    // The kobo is ours to assign; a customer can't choose the figure they will be matched on.
    if (!Number.isInteger(amount)) return NextResponse.json({ error: 'Enter a whole-naira amount.' }, { status: 400 })
    if (amount > 10_000_000) return NextResponse.json({ error: 'That amount is too large for one transfer.' }, { status: 400 })
  }

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const plan = await prisma.savingsPlan.findFirst({
    where: { customerId: customer.id, status: 'Active', ...(typeof input.planId === 'string' ? { id: input.planId } : {}) },
    orderBy: { startDate: 'desc' },
  })
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  if (planHasEnded(plan)) return NextResponse.json({ error: PLAN_ENDED }, { status: 409 })
  if (await hasOpenRedemption(prisma, plan.id)) {
    return NextResponse.json({ error: 'You’ve asked to collect from this plan. You can’t add money until that request is finished.' }, { status: 409 })
  }

  // Flexible plans: the super admin's smallest deposit, never below the ₦100 every transfer needs.
  if (!catchup && isFlexible(plan.cadence)) {
    const min = Math.max(100, (await getFlexibleSettings(prisma)).minDeposit)
    if (amount < min) return NextResponse.json({ error: `The smallest deposit is ₦${min.toLocaleString('en-NG')}.` }, { status: 400 })
  }

  if (catchup) {
    const check = await checkBulkSelection(prisma, plan, keys, new Date(), { kind: 'customer', customerId: customer.id })
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status })
    amount = money(check.total)
  }

  const intent = await createTransferIntent({ actor: { customerId: customer.id }, planId: plan.id, baseAmount: amount, coversKeys: catchup ? keys : undefined })
  if (!intent) return NextResponse.json({ error: 'Lots of people are paying right now. Please try again in a few minutes.' }, { status: 503 })

  logAudit({
    action: 'transfer_initiated',
    entity: 'PaymentIntent',
    details: `${customer.firstName} ${customer.lastName} (${customer.customerId}) started a bank transfer of ₦${intent.payAmount.toFixed(2)} — ref ${intent.ref} — plan ${plan.id}`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: `${customer.firstName} ${customer.lastName}`,
  })

  return NextResponse.json({
    ref: intent.ref,
    payAmount: intent.payAmount,
    expiresAt: intent.expiresAt.toISOString(),
    account: {
      bank: 'Moniepoint',
      number: requireEnv('MONIEPOINT_ACCOUNT_NUMBER'),
      name: requireEnv('MONIEPOINT_ACCOUNT_NAME'),
    },
  })
}
