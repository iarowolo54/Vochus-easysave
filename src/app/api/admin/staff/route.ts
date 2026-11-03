import { NextRequest, NextResponse } from 'next/server'
import { requireAdminArea, actorPermissions, findLeadDepartmentId } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { findIdentityConflict } from '@/lib/identity'
import { identityConflictResponse } from '@/lib/identity-response'
import { staffSelect, toStaffResponse } from '@/lib/staff-response'
import { issueStaffInvite } from '@/lib/staff-invite'
import { canGrant, parsePermissions } from '@/lib/permissions'

// Owner: everyone. A department lead: only their own department's people (fresh lookup). Anyone else: 403.
async function resolveScope() {
  const guard = await requireAdminArea()
  if (!guard.ok) return { ok: false as const, response: guard.response }
  if (guard.actor.type === 'superadmin') return { ok: true as const, actor: guard.actor, leadDept: null }
  const leadDept = guard.actor.id ? await findLeadDepartmentId(guard.actor.id) : null
  if (!leadDept) return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { ok: true as const, actor: guard.actor, leadDept }
}

export async function GET() {
  const scope = await resolveScope()
  if (!scope.ok) return scope.response

  const rows = await prisma.staffUser.findMany({
    where: scope.leadDept ? { departmentId: scope.leadDept } : undefined,
    orderBy: { createdAt: 'desc' },
    select: staffSelect,
  })

  return NextResponse.json({ staff: rows.map(toStaffResponse) })
}

export async function POST(req: NextRequest) {
  const scope = await resolveScope()
  if (!scope.ok) return scope.response

  const body: unknown = await req.json().catch(() => null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const rawEmail = typeof b.email === 'string' ? b.email : ''
  const roleId = typeof b.roleId === 'string' && b.roleId ? b.roleId : null

  // There is no password field: every new staffer is invited and sets their own.
  if (!name || !rawEmail.trim()) {
    return NextResponse.json({ error: 'name and email are required' }, { status: 400 })
  }
  if (b.roleId !== undefined && b.roleId !== null && !roleId) {
    return NextResponse.json({ error: 'roleId must be a non-empty string' }, { status: 400 })
  }
  if (b.departmentId !== undefined && b.departmentId !== null && typeof b.departmentId !== 'string') {
    return NextResponse.json({ error: 'departmentId must be a string' }, { status: 400 })
  }

  // Staff login looks up by normalized lowercase email, so store it lowercased.
  const email = rawEmail.trim().toLowerCase()

  // Membership is explicit: a lead's hire always lands in the lead's department; the owner picks (or the role decides).
  let departmentId = scope.leadDept ?? (typeof b.departmentId === 'string' && b.departmentId ? b.departmentId : null)
  if (roleId) {
    const role = await prisma.role.findUnique({
      where: { id: roleId },
      select: { id: true, status: true, permissions: true, departmentId: true, department: { select: { status: true } } },
    })
    if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 })
    if (role.status !== 'Active' || role.department.status !== 'Active') {
      return NextResponse.json({ error: 'That role is archived' }, { status: 400 })
    }
    if (departmentId && role.departmentId !== departmentId) {
      // For a lead this is also "a role from another department".
      return NextResponse.json(
        { error: scope.leadDept ? 'Forbidden' : 'The role must belong to the chosen department' },
        { status: scope.leadDept ? 403 : 400 },
      )
    }
    // A lead can only give someone access they hold themselves.
    if (scope.leadDept && !canGrant(await actorPermissions(scope.actor), parsePermissions(role.permissions))) {
      return NextResponse.json({ error: 'You can only assign roles within your own access' }, { status: 403 })
    }
    departmentId = role.departmentId
  } else if (departmentId && !(await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } }))) {
    return NextResponse.json({ error: 'Department not found' }, { status: 404 })
  }

  const conflict = await findIdentityConflict(prisma, { email })
  if (conflict) return identityConflictResponse(conflict)

  const created = await prisma.staffUser.create({
    data: { name, email, status: 'Invited', password: null, ...(roleId ? { roleId } : {}), ...(departmentId ? { departmentId } : {}) },
    select: staffSelect,
  })
  const issued = await issueStaffInvite({ id: created.id, name: created.name, email: created.email })

  logAudit({
    action: 'staff_created',
    entity: 'StaffUser',
    entityId: created.id,
    details: `Invited ${name} (${email}) to ${created.department?.name ?? 'no department'} as ${created.roleRef?.name ?? 'unassigned'}`,
    actorType: scope.actor.type,
    actorId: scope.actor.id,
    actorName: scope.actor.name,
  })

  // The raw link is a bearer credential for the new account: only the owner is shown it; a lead relies on the email.
  return NextResponse.json(
    {
      staff: toStaffResponse(created),
      emailed: issued?.emailed ?? false,
      ...(scope.actor.type === 'superadmin' && issued ? { link: issued.link } : {}),
    },
    { status: 201 },
  )
}
