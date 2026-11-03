import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

// Frees a customer's account from the phone it is locked to, so they can sign in on a new one (the next sign-in binds again).
// Same permissions as resetting an agent's device. A customer who isn't bound to a phone changes nothing and writes no audit entry.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAnyPermission([['customers', 'manage'], ['devices', 'manage']])
  if (!guard.ok) return guard.response

  const { id } = await params
  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, firstName: true, lastName: true, customerId: true, boundDeviceId: true },
  })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  if (!customer.boundDeviceId) return NextResponse.json({ ok: true, reset: false })

  // Only clear the binding we just looked at, so a second admin click or a fresh sign-in is not undone by mistake.
  const cleared = await prisma.customer.updateMany({ where: { id, boundDeviceId: customer.boundDeviceId }, data: { boundDeviceId: null } })
  if (cleared.count === 0) return NextResponse.json({ ok: true, reset: false })

  logAudit({
    action: 'customer_reset_device',
    entity: 'Customer',
    entityId: customer.id,
    details: `Reset bound device for ${customer.firstName} ${customer.lastName} (${customer.customerId})`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true, reset: true })
}
