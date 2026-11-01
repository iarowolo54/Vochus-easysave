import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { staffSelect, toStaffResponse } from '@/lib/staff-response'

const STATUSES = ['Active', 'Suspended']

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await params
  const body: unknown = await req.json().catch(() => null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  const data: { status?: string; roleId?: string | null } = {}
  const changed: string[] = []

  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !STATUSES.includes(b.status)) {
      return NextResponse.json({ error: "status must be 'Active' or 'Suspended'" }, { status: 400 })
    }
    data.status = b.status
    changed.push(`status=${b.status}`)
  }

  if (b.roleId !== undefined) {
    if (b.roleId === null) {
      data.roleId = null
      changed.push('role unassigned')
    } else if (typeof b.roleId === 'string' && b.roleId) {
      const role = await prisma.role.findUnique({ where: { id: b.roleId }, select: { id: true, name: true } })
      if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 })
      data.roleId = role.id
      changed.push(`role=${role.name}`)
    } else {
      return NextResponse.json({ error: 'roleId must be a string or null' }, { status: 400 })
    }
  }

  if (changed.length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const existing = await prisma.staffUser.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

  const updated = await prisma.staffUser.update({
    where: { id },
    data,
    select: staffSelect,
  })

  const adminUser = session.user as { name?: string; id?: string }
  logAudit({
    action: 'staff_updated',
    entity: 'StaffUser',
    entityId: id,
    details: `Updated staff ${updated.name} (${updated.email}): ${changed.join(', ')}`,
    actorType: 'admin',
    actorId: adminUser.id,
    actorName: adminUser.name ?? 'Admin',
  })

  return NextResponse.json({ staff: toStaffResponse(updated) })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await params

  const target = await prisma.staffUser.findUnique({ where: { id }, select: { name: true, email: true } })
  await prisma.staffUser.delete({ where: { id } })

  const adminUser = session.user as { name?: string; id?: string }
  logAudit({
    action: 'staff_deleted',
    entity: 'StaffUser',
    entityId: id,
    details: `Deleted staff account ${target?.name ?? id} (${target?.email ?? ''})`,
    actorType: 'admin',
    actorId: adminUser.id,
    actorName: adminUser.name ?? 'Admin',
  })

  return NextResponse.json({ ok: true })
}
