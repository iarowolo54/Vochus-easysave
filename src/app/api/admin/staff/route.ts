import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { logAudit } from '@/lib/audit'
import { findIdentityConflict } from '@/lib/identity'
import { identityConflictResponse } from '@/lib/identity-response'

export async function GET() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const staff = await prisma.staffUser.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      permissions: true,
      status: true,
      lastActiveAt: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ staff })
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { name, email, role, permissions, password } = await req.json()
  if (!name || !email || !role || !password) {
    return NextResponse.json({ error: 'name, email, role and password are required' }, { status: 400 })
  }

  const conflict = await findIdentityConflict(prisma, { email })
  if (conflict) return identityConflictResponse(conflict)

  const hashed = await bcrypt.hash(password, 10)

  const staff = await prisma.staffUser.create({
    data: {
      name,
      email,
      role,
      permissions: JSON.stringify(permissions ?? []),
      password: hashed,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      permissions: true,
      status: true,
      lastActiveAt: true,
      createdAt: true,
    },
  })

  const adminUser = session.user as { name?: string; id?: string }
  logAudit({
    action: 'staff_created',
    entity: 'StaffUser',
    entityId: staff.id,
    details: `Created staff account for ${name} (${email}) with role ${role}`,
    actorType: 'admin',
    actorId: (adminUser as any).id,
    actorName: adminUser.name ?? 'Admin',
  })

  return NextResponse.json({ staff }, { status: 201 })
}
