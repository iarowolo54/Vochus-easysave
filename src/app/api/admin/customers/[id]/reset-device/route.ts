import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

// Frees a customer's account from the phone it is locked to, so they can sign in on a new one (the next sign-in binds again), and
// signs out their current phone and revokes its fingerprint sign-in. That happens whether or not a lock was set, the same as for
// agents, because the usual reason is a lost or replaced phone. The customer signs in again with their password.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAnyPermission([['customers', 'manage'], ['devices', 'manage']])
  if (!guard.ok) return guard.response

  const { id } = await params
  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, firstName: true, lastName: true, customerId: true },
  })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const revoked = await prisma.$transaction(async (tx) => {
    await tx.customer.update({ where: { id }, data: { boundDeviceId: null, tokenVersion: { increment: 1 } } })
    const tokens = await tx.biometricToken.updateMany({ where: { customerId: id, revokedAt: null }, data: { revokedAt: new Date() } })
    return tokens.count
  })

  logAudit({
    action: 'customer_reset_device',
    entity: 'Customer',
    entityId: customer.id,
    details: `Reset device for ${customer.firstName} ${customer.lastName} (${customer.customerId}): lock cleared, signed out, ${revoked} fingerprint sign-in${revoked === 1 ? '' : 's'} revoked`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true })
}
