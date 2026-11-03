import { NextRequest, NextResponse } from 'next/server'
import { requireDeptManage, actorPermissions } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { canEditRole, canGrant, parsePermissions, validateRolePermissions } from '@/lib/permissions'

const STATUSES = ['Active', 'Archived']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const existing = await prisma.role.findUnique({ where: { id } })
  // Owner, or the lead of the role's own department (re-checked fresh). A foreign id looks the same as a missing one to a lead.
  const guard = await requireDeptManage(existing?.departmentId ?? '')
  if (!guard.ok) return guard.response
  if (!existing) return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  const leadCeiling = guard.actor.type === 'staff' ? await actorPermissions(guard.actor) : null

  const body: unknown = await req.json().catch(() => null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const data: { name?: string; permissions?: string; status?: string } = {}

  if (b.name !== undefined) {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'name cannot be blank' }, { status: 400 })
    if (name !== existing.name) {
      const dup = await prisma.role.findUnique({
        where: { departmentId_name: { departmentId: existing.departmentId, name } },
      })
      if (dup) {
        return NextResponse.json({ error: 'A role with that name already exists in this department' }, { status: 400 })
      }
      data.name = name
    }
  }
  if (b.permissions !== undefined) {
    const perms = validateRolePermissions(b.permissions)
    if (!perms.ok) {
      return NextResponse.json(
        {
          error: perms.unknown.length
            ? `Unknown permissions: ${perms.unknown.join(', ')}`
            : 'permissions must be an array of screen:action tokens',
          unknown: perms.unknown,
        },
        { status: 400 },
      )
    }
    // A lead may edit only a role whose current AND resulting access are within their own.
    if (leadCeiling && !canEditRole(leadCeiling, parsePermissions(existing.permissions), perms.perms)) {
      return NextResponse.json({ error: 'You can only grant access you hold yourself' }, { status: 403 })
    }
    data.permissions = JSON.stringify(perms.perms)
  }
  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !STATUSES.includes(b.status)) {
      return NextResponse.json({ error: "status must be 'Active' or 'Archived'" }, { status: 400 })
    }
    data.status = b.status
  }

  // Renaming or archiving a role above the lead's ceiling is just as off-limits.
  if (leadCeiling && !canGrant(leadCeiling, parsePermissions(existing.permissions))) {
    return NextResponse.json({ error: 'You can only change roles within your own access' }, { status: 403 })
  }

  let role
  try {
    role = await prisma.role.update({ where: { id }, data })
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (code === 'P2002') {
      return NextResponse.json({ error: 'A role with that name already exists in this department' }, { status: 400 })
    }
    if (code === 'P2025') return NextResponse.json({ error: 'Role not found' }, { status: 404 })
    throw e
  }

  logAudit({
    action: 'role_updated',
    entity: 'Role',
    entityId: id,
    details: `Updated role "${existing.name}": ${Object.keys(data).join(', ') || 'no changes'}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ role: { ...role, permissions: parsePermissions(role.permissions) } })
}
