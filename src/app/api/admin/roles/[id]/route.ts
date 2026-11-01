import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, adminActor } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { parsePermissions, validateRolePermissions } from '@/lib/permissions'

const STATUSES = ['Active', 'Archived']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const { id } = await params

  const existing = await prisma.role.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Role not found' }, { status: 404 })

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
            ? `Unknown permission keys: ${perms.unknown.join(', ')}`
            : 'permissions must be an array of area keys',
          unknown: perms.unknown,
        },
        { status: 400 },
      )
    }
    data.permissions = JSON.stringify(perms.areas)
  }
  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !STATUSES.includes(b.status)) {
      return NextResponse.json({ error: "status must be 'Active' or 'Archived'" }, { status: 400 })
    }
    data.status = b.status
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
    actorType: 'admin',
    ...adminActor(guard.session),
  })

  return NextResponse.json({ role: { ...role, permissions: parsePermissions(role.permissions) } })
}
