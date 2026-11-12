import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { verifyApprovalPin } from '@/lib/approval-pin'
import { findIdentityConflict } from '@/lib/identity'
import { CUSTOMER_PROFILE_FIELDS, describeChanges, diffProfile, formValue } from '@/lib/profile-edit'

type Ctx = { params: Promise<{ id: string }> }
const select = Object.fromEntries(CUSTOMER_PROFILE_FIELDS.map(f => [f.key, true])) as Record<string, true>

/** The customer's editable details, as the edit form shows them. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission('customers', 'view')
  if (!guard.ok) return guard.response
  const { id } = await params
  const c = await prisma.customer.findUnique({ where: { id }, select })
  if (!c) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const values = Object.fromEntries(CUSTOMER_PROFILE_FIELDS.map(f => [f.key, formValue(f.kind, (c as Record<string, unknown>)[f.key])]))
  const canManage = (await requirePermission('customers', 'manage')).ok
  return NextResponse.json({ values, canManage })
}

/** Staff correct a customer's details. A new phone or email needs the approval PIN; every change is audited. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission('customers', 'manage')
  if (!guard.ok) return guard.response
  const { id } = await params
  const body: unknown = await req.json().catch(() => null)
  const values = (body && typeof body === 'object' ? (body as { values?: unknown }).values : null) ?? {}

  const current = await prisma.customer.findUnique({ where: { id }, select: { ...select, id: true, customerId: true, firstName: true, lastName: true } })
  if (!current) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const diff = diffProfile(CUSTOMER_PROFILE_FIELDS, current, values, { dobAs: 'date' })
  if (!diff.ok) return NextResponse.json({ error: diff.error }, { status: 400 })
  if (diff.changes.length === 0) return NextResponse.json({ error: 'Nothing has changed.' }, { status: 400 })

  if (diff.signInChanged) {
    const pin = await verifyApprovalPin(guard.session, (body as { pin?: unknown }).pin)
    if (!pin.ok) return pin.response
    const conflict = await findIdentityConflict(prisma, {
      phone: typeof diff.data.phone === 'string' ? diff.data.phone : null,
      email: typeof diff.data.email === 'string' ? diff.data.email : null,
    }, { excludeCustomerId: id })
    if (conflict) return NextResponse.json({ error: `That ${conflict === 'phone' ? 'phone number' : 'email'} already belongs to another account.` }, { status: 409 })
  }

  const emailChanged = diff.changes.some(c => c.key === 'email')
  // A new email isn't proven yet: codes never go to an unconfirmed address.
  await prisma.customer.update({ where: { id }, data: { ...diff.data, ...(emailChanged && { emailVerifiedAt: null }) } })

  logAudit({
    action: 'customer_profile_edited',
    entity: 'Customer',
    entityId: id,
    details: `Details changed for customer ${current.firstName} ${current.lastName} (${current.customerId}): ${describeChanges(diff.changes)}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ changed: diff.changes.map(c => c.label) })
}
