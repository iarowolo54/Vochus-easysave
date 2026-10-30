import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { cancelMandate } from '@/lib/auto-debit'
import { deactivateAuthorization } from '@/lib/paystack'

export async function POST(req: NextRequest) {
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

  // Owner in the where on both rows: foreign or missing is a 404.
  const plan = await prisma.savingsPlan.findFirst({
    where: { id: planId, customerId: session.id },
    select: { id: true },
  })
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const mandate = await prisma.autoDebitMandate.findFirst({
    where: { savingsPlanId: plan.id, customerId: session.id },
    select: { id: true, authorizationCode: true },
  })
  if (!mandate) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Local cancel is what stops our debits; do it first and keep it even if Paystack fails.
  await cancelMandate(prisma, mandate.id)
  await logAudit({
    action: 'auto_debit_cancelled',
    entity: 'AutoDebitMandate',
    entityId: mandate.id,
    details: `Customer cancelled auto-debit for plan ${plan.id}`,
    actorType: 'customer',
    actorId: session.id,
  })

  try {
    await deactivateAuthorization(mandate.authorizationCode)
  } catch (e) {
    await logAudit({
      action: 'auto_debit_deactivate_failed',
      entity: 'AutoDebitMandate',
      entityId: mandate.id,
      details: `Paystack authorization deactivate failed for plan ${plan.id}: ${e instanceof Error ? e.message : 'unknown error'}`,
      actorType: 'customer',
      actorId: session.id,
    })
  }

  return NextResponse.json({ status: 'cancelled' })
}
