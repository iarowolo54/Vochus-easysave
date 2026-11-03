import { NextRequest, NextResponse } from 'next/server'
import { requireAdminArea, requireDeptManage, actorPermissions, findLeadDepartmentId } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { canGrant, parsePermissions, validateRolePermissions } from '@/lib/permissions'

export async function GET(req: NextRequest) {
  // The owner sees every role (optionally one department's); a department lead sees only their own department's.
  const guard = await requireAdminArea()
  if (!guard.ok) return guard.response

  let departmentId = req.nextUrl.searchParams.get('departmentId')
  if (guard.actor.type === 'staff') {
    const leadDept = guard.actor.id ? await findLeadDepartmentId(guard.actor.id) : null
    if (!leadDept || (departmentId && departmentId !== leadDept)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    departmentId = leadDept
  }

  const rows = await prisma.role.findMany({
    where: departmentId ? { departmentId } : undefined,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      permissions: true,
      department: { select: { id: true, name: true } },
      _count: { select: { staff: true } },
    },
  })
  const roles = rows.map(({ _count, permissions, ...r }) => ({
    ...r,
    permissions: parsePermissions(permissions),
    staffCount: _count.staff,
  }))
  return NextResponse.json({ roles })
}

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  // Owner, or the lead of exactly this department.
  const departmentId = typeof b.departmentId === 'string' ? b.departmentId : ''
  if (!departmentId) {
    const early = await requireAdminArea()
    if (!early.ok) return early.response
    return NextResponse.json({ error: 'departmentId is required' }, { status: 400 })
  }
  const guard = await requireDeptManage(departmentId)
  if (!guard.ok) return guard.response

  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

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

  // A lead can only hand out access they hold themselves; the owner is unbounded.
  if (guard.actor.type === 'staff' && !canGrant(await actorPermissions(guard.actor), perms.perms)) {
    return NextResponse.json({ error: 'You can only grant access you hold yourself' }, { status: 403 })
  }

  const dept = await prisma.department.findUnique({ where: { id: departmentId } })
  if (!dept) return NextResponse.json({ error: 'Department not found' }, { status: 404 })

  if (await prisma.role.findUnique({ where: { departmentId_name: { departmentId, name } } })) {
    return NextResponse.json({ error: 'A role with that name already exists in this department' }, { status: 400 })
  }

  let role
  try {
    role = await prisma.role.create({
      data: { departmentId, name, permissions: JSON.stringify(perms.perms), status: 'Active' },
    })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'A role with that name already exists in this department' }, { status: 400 })
    }
    throw e
  }

  logAudit({
    action: 'role_created',
    entity: 'Role',
    entityId: role.id,
    details: `Created role "${name}" in ${dept.name} with [${perms.perms.join(', ')}]`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ role: { ...role, permissions: perms.perms } }, { status: 201 })
}
