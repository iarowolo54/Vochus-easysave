import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, requireAdminArea, adminActor, findLeadDepartmentId } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { validateRolePermissions, type Perm } from '@/lib/permissions'

export async function GET() {
  // The owner sees every department; a department lead sees only their own (fresh lookup).
  const guard = await requireAdminArea()
  if (!guard.ok) return guard.response
  let where: { id: string } | undefined
  if (guard.actor.type === 'staff') {
    const leadDept = guard.actor.id ? await findLeadDepartmentId(guard.actor.id) : null
    if (!leadDept) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    where = { id: leadDept }
  }

  const rows = await prisma.department.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      createdAt: true,
      lead: { select: { id: true, name: true } },
      _count: { select: { roles: true, members: true } },
    },
  })
  const departments = rows.map(({ _count, ...d }) => ({ ...d, roleCount: _count.roles, memberCount: _count.members }))
  return NextResponse.json({ departments })
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response

  const body: unknown = await req.json().catch(() => null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (b.description !== undefined && b.description !== null && typeof b.description !== 'string') {
    return NextResponse.json({ error: 'description must be a string' }, { status: 400 })
  }
  const description = typeof b.description === 'string' ? b.description.trim() || null : null

  // Optional inline roles: [{ name, permissions }], each validated like a standalone role.
  const roleInputs: { name: string; perms: Perm[] }[] = []
  if (b.roles !== undefined) {
    if (!Array.isArray(b.roles)) return NextResponse.json({ error: 'roles must be an array' }, { status: 400 })
    const seen = new Set<string>()
    for (const r of b.roles) {
      const rb = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
      const rname = typeof rb.name === 'string' ? rb.name.trim() : ''
      if (!rname) return NextResponse.json({ error: 'Every role needs a name' }, { status: 400 })
      if (seen.has(rname)) return NextResponse.json({ error: `Duplicate role name: ${rname}` }, { status: 400 })
      seen.add(rname)
      const perms = validateRolePermissions(rb.permissions ?? [])
      if (!perms.ok) {
        return NextResponse.json(
          { error: perms.unknown.length ? `Unknown permissions: ${perms.unknown.join(', ')}` : 'permissions must be an array', unknown: perms.unknown },
          { status: 400 },
        )
      }
      roleInputs.push({ name: rname, perms: perms.perms })
    }
  }

  if (await prisma.department.findUnique({ where: { name } })) {
    return NextResponse.json({ error: 'A department with that name already exists' }, { status: 400 })
  }

  let department
  try {
    department = await prisma.department.create({
      data: {
        name,
        description,
        status: 'Active',
        roles: { create: roleInputs.map((r) => ({ name: r.name, permissions: JSON.stringify(r.perms), status: 'Active' })) },
      },
    })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'A department with that name already exists' }, { status: 400 })
    }
    throw e
  }

  logAudit({
    action: 'department_created',
    entity: 'Department',
    entityId: department.id,
    details: `Created department "${name}"${roleInputs.length ? ` with roles: ${roleInputs.map((r) => r.name).join(', ')}` : ''}`,
    actorType: 'admin',
    ...adminActor(guard.session),
  })

  return NextResponse.json({ department }, { status: 201 })
}
