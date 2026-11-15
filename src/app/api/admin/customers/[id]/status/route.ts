import { NextRequest, NextResponse } from 'next/server'
import { requirePermission, isNotFound } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('customers', 'manage')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await params
  const body: unknown = await req.json().catch(() => null)
  const status = body && typeof body === 'object' ? (body as { status?: unknown }).status : undefined
  if (status !== 'Active' && status !== 'Locked') {
    return NextResponse.json({ error: 'status must be Active or Locked' }, { status: 400 })
  }

  const customer = await prisma.customer.update({
    where: { id },
    // Locking also ends every session the customer already has open.
    data: { status, ...(status === 'Locked' ? { tokenVersion: { increment: 1 } } : {}) },
    select: { id: true, customerId: true, firstName: true, lastName: true, status: true },
  }).catch((e: unknown) => { if (isNotFound(e)) return null; throw e })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  logAudit({
    action: status === 'Locked' ? 'customer_lock' : 'customer_unlock',
    entity: 'Customer',
    entityId: customer.id,
    details: `${status === 'Locked' ? 'Locked' : 'Unlocked'} customer ${customer.firstName} ${customer.lastName} (${customer.customerId})`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true, customer })
}
