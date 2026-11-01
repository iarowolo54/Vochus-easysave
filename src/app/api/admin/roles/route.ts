import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, adminActor } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { parsePermissions, validateRolePermissions } from '@/lib/permissions'

export async function GET(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response

  const departmentId = req.nextUrl.searchParams.get('departmentId')
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
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response

  const body: unknown = await req.json().catch(() => null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const departmentId = typeof b.departmentId === 'string' ? b.departmentId : ''
  if (!departmentId) return NextResponse.json({ error: 'departmentId is required' }, { status: 400 })

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

  const dept = await prisma.department.findUnique({ where: { id: departmentId } })
  if (!dept) return NextResponse.json({ error: 'Department not found' }, { status: 404 })

  if (await prisma.role.findUnique({ where: { departmentId_name: { departmentId, name } } })) {
    return NextResponse.json({ error: 'A role with that name already exists in this department' }, { status: 400 })
  }

  let role
  try {
    role = await prisma.role.create({
      data: { departmentId, name, permissions: JSON.stringify(perms.areas), status: 'Active' },
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
    details: `Created role "${name}" in ${dept.name} with areas [${perms.areas.join(', ')}]`,
    actorType: 'admin',
    ...adminActor(guard.session),
  })

  return NextResponse.json({ role: { ...role, permissions: perms.areas } }, { status: 201 })
}
