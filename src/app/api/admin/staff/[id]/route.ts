import { NextRequest, NextResponse } from 'next/server'
import { requireDeptManage, requireSuperAdmin, actorPermissions, adminActor } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { staffSelect, toStaffResponse } from '@/lib/staff-response'
import { canGrant, parsePermissions } from '@/lib/permissions'

const STATUSES = ['Active', 'Suspended']

type Actor = { id?: string; name: string; type: 'superadmin' | 'staff' }

// Loads the target and decides who may act: the owner, or the lead of the staffer's own department (re-checked fresh).
// A lead may not touch someone whose role is above the lead's own access.
async function loadAndAuthorize(id: string) {
  const target = await prisma.staffUser.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, status: true, password: true, departmentId: true, roleRef: { select: { permissions: true } } },
  })
  let actor: Actor
  if (target?.departmentId) {
    const guard = await requireDeptManage(target.departmentId)
    if (!guard.ok) return { ok: false as const, response: guard.response }
    actor = guard.actor
  } else {
    const guard = await requireSuperAdmin()
    if (!guard.ok) return { ok: false as const, response: guard.response }
    const a = adminActor(guard.session)
    actor = { id: a.actorId, name: a.actorName, type: 'superadmin' }
  }
  if (!target) return { ok: false as const, response: NextResponse.json({ error: 'Staff not found' }, { status: 404 }) }
  const ceiling = actor.type === 'staff' ? await actorPermissions(actor) : null
  if (ceiling && !canGrant(ceiling, parsePermissions(target.roleRef?.permissions))) {
    return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true as const, actor, target, ceiling }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await loadAndAuthorize(id)
  if (!auth.ok) return auth.response
  const { actor, target, ceiling } = auth

  const body: unknown = await req.json().catch(() => null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  const data: { status?: string; roleId?: string | null; departmentId?: string | null } = {}
  const changed: string[] = []
  let clearLeadOf: string | null = null

  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !STATUSES.includes(b.status)) {
      return NextResponse.json({ error: "status must be 'Active' or 'Suspended'" }, { status: 400 })
    }
    // Someone who never set a password goes back to waiting on their invite, not straight to Active.
    data.status = b.status === 'Active' && !target.password ? 'Invited' : b.status
    changed.push(`status=${data.status}`)
  }

  // Moving someone between departments is owner-only.
  let newDepartmentId = target.departmentId
  if (b.departmentId !== undefined) {
    if (actor.type !== 'superadmin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (b.departmentId !== null && (typeof b.departmentId !== 'string' || !b.departmentId)) {
      return NextResponse.json({ error: 'departmentId must be a string or null' }, { status: 400 })
    }
    if (b.departmentId && !(await prisma.department.findUnique({ where: { id: b.departmentId }, select: { id: true } }))) {
      return NextResponse.json({ error: 'Department not found' }, { status: 404 })
    }
    newDepartmentId = b.departmentId
    if (newDepartmentId !== target.departmentId) {
      data.departmentId = newDepartmentId
      data.roleId = null // the old role belongs to the old department
      clearLeadOf = target.departmentId
      changed.push('department changed')
    }
  }

  if (b.roleId !== undefined) {
    if (b.roleId === null) {
      data.roleId = null
      changed.push('role unassigned')
    } else if (typeof b.roleId === 'string' && b.roleId) {
      const role = await prisma.role.findUnique({
        where: { id: b.roleId },
        select: { id: true, name: true, status: true, permissions: true, departmentId: true },
      })
      if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 })
      if (role.status !== 'Active') return NextResponse.json({ error: 'That role is archived' }, { status: 400 })
      // The role must belong to the staffer's department; with no department yet, the owner's choice sets it.
      if (newDepartmentId && role.departmentId !== newDepartmentId) {
        return NextResponse.json({ error: 'The role must belong to the staffer\'s department' }, { status: 400 })
      }
      if (ceiling && !canGrant(ceiling, parsePermissions(role.permissions))) {
        return NextResponse.json({ error: 'You can only assign roles within your own access' }, { status: 403 })
      }
      data.roleId = role.id
      if (!newDepartmentId) data.departmentId = role.departmentId
      changed.push(`role=${role.name}`)
    } else {
      return NextResponse.json({ error: 'roleId must be a string or null' }, { status: 400 })
    }
  }

  if (changed.length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const [updated] = await prisma.$transaction([
    prisma.staffUser.update({ where: { id }, data, select: staffSelect }),
    // A staffer moved out of a department can no longer lead it.
    ...(clearLeadOf
      ? [prisma.department.updateMany({ where: { id: clearLeadOf, leadId: id }, data: { leadId: null } })]
      : []),
  ])

  logAudit({
    action: 'staff_updated',
    entity: 'StaffUser',
    entityId: id,
    details: `Updated staff ${updated.name} (${updated.email}): ${changed.join(', ')}`,
    actorType: actor.type,
    actorId: actor.id,
    actorName: actor.name,
  })

  return NextResponse.json({ staff: toStaffResponse(updated) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await loadAndAuthorize(id)
  if (!auth.ok) return auth.response
  const { actor, target } = auth

  if (actor.id === id) return NextResponse.json({ error: 'You can’t remove your own account' }, { status: 400 })

  await prisma.staffUser.delete({ where: { id } })

  logAudit({
    action: 'staff_deleted',
    entity: 'StaffUser',
    entityId: id,
    details: `Deleted staff account ${target.name} (${target.email})`,
    actorType: actor.type,
    actorId: actor.id,
    actorName: actor.name,
  })

  return NextResponse.json({ ok: true })
}
