import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { requireAdminArea } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { resolvePinOwner } from '@/lib/approval-pin'

// Self-service: changes the password on the signed-in actor's OWN row only (id comes from the session).
export async function POST(req: NextRequest) {
  const guard = await requireAdminArea()
  if (!guard.ok) return guard.response

  const body: unknown = await req.json().catch(() => null)
  const { currentPassword, newPassword } = (body ?? {}) as { currentPassword?: unknown; newPassword?: unknown }
  if (!currentPassword || typeof currentPassword !== 'string') return NextResponse.json({ error: 'Current password required' }, { status: 400 })
  if (typeof newPassword !== 'string' || newPassword.length < 8) return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 })

  const user = guard.session.user as { id?: string; email?: string; role?: unknown }
  const where = user.id ? { id: user.id } : { email: user.email }
  const isStaff = resolvePinOwner(user.role) === 'staff'
  const actor = isStaff
    ? await prisma.staffUser.findFirst({ where, select: { id: true, name: true, email: true, password: true } })
    : await prisma.superAdmin.findFirst({ where, select: { id: true, name: true, email: true, password: true } })
  if (!actor) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const validPassword = await bcrypt.compare(currentPassword, actor.password)
  if (!validPassword) return NextResponse.json({ error: 'Incorrect password' }, { status: 403 })

  const hashed = await bcrypt.hash(newPassword, 10)
  if (isStaff) await prisma.staffUser.update({ where: { id: actor.id }, data: { password: hashed } })
  else await prisma.superAdmin.update({ where: { id: actor.id }, data: { password: hashed } })

  logAudit({
    action: 'password_changed',
    entity: isStaff ? 'StaffUser' : 'SuperAdmin',
    entityId: actor.id,
    details: `${actor.name} (${actor.email}) changed their password`,
    actorType: 'admin',
    actorId: actor.id,
    actorName: actor.name ?? 'Admin',
  })

  return NextResponse.json({ ok: true })
}
