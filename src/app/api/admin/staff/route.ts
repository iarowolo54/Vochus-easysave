import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { logAudit } from '@/lib/audit'
import { findIdentityConflict } from '@/lib/identity'
import { identityConflictResponse } from '@/lib/identity-response'
import { staffSelect, toStaffResponse } from '@/lib/staff-response'

export async function GET() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response

  const rows = await prisma.staffUser.findMany({
    orderBy: { createdAt: 'desc' },
    select: staffSelect,
  })

  return NextResponse.json({ staff: rows.map(toStaffResponse) })
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const body: unknown = await req.json().catch(() => null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const rawEmail = typeof b.email === 'string' ? b.email : ''
  const password = typeof b.password === 'string' ? b.password : ''
  const roleId = typeof b.roleId === 'string' && b.roleId ? b.roleId : null

  if (!name || !rawEmail.trim() || !password) {
    return NextResponse.json({ error: 'name, email and password are required' }, { status: 400 })
  }
  if (b.roleId !== undefined && b.roleId !== null && !roleId) {
    return NextResponse.json({ error: 'roleId must be a non-empty string' }, { status: 400 })
  }

  // Staff login looks up by normalized lowercase email, so store it lowercased.
  const email = rawEmail.trim().toLowerCase()

  if (roleId) {
    const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true } })
    if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  }

  const conflict = await findIdentityConflict(prisma, { email })
  if (conflict) return identityConflictResponse(conflict)

  const hashed = await bcrypt.hash(password, 10)

  const created = await prisma.staffUser.create({
    data: {
      name,
      email,
      password: hashed,
      ...(roleId ? { roleId } : {}),
    },
    select: staffSelect,
  })

  const adminUser = session.user as { name?: string; id?: string }
  logAudit({
    action: 'staff_created',
    entity: 'StaffUser',
    entityId: created.id,
    details: `Created staff account for ${name} (${email}) with role ${created.roleRef?.name ?? 'none (unassigned)'}`,
    actorType: 'admin',
    actorId: adminUser.id,
    actorName: adminUser.name ?? 'Admin',
  })

  return NextResponse.json({ staff: toStaffResponse(created) }, { status: 201 })
}
