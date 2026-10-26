import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await params
  const body = await req.json()

  const data: Record<string, unknown> = {}
  if (body.status !== undefined) data.status = body.status
  if (body.role !== undefined) data.role = body.role
  if (body.permissions !== undefined) data.permissions = JSON.stringify(body.permissions)

  const staff = await prisma.staffUser.update({
    where: { id },
    data,
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
    action: 'staff_updated',
    entity: 'StaffUser',
    entityId: id,
    details: `Updated staff ${staff.name} (${staff.email}): ${Object.keys(body).join(', ')} changed`,
    actorType: 'admin',
    actorId: (adminUser as any).id,
    actorName: adminUser.name ?? 'Admin',
  })

  return NextResponse.json({ staff })
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
    actorId: (adminUser as any).id,
    actorName: adminUser.name ?? 'Admin',
  })

  return NextResponse.json({ ok: true })
}
