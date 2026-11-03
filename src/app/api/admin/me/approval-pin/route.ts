import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { requireAdminArea } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { resolvePinOwner } from '@/lib/approval-pin'

// Self-service: sets the PIN on the signed-in actor's OWN row only (id comes from the session).
export async function POST(req: NextRequest) {
  const guard = await requireAdminArea()
  if (!guard.ok) return guard.response

  const body: unknown = await req.json().catch(() => null)
  const { pin, currentPassword } = (body ?? {}) as { pin?: unknown; currentPassword?: unknown }
  if (typeof pin !== 'string' || !/^\d{4,}$/.test(pin)) return NextResponse.json({ error: 'PIN must be at least 4 digits' }, { status: 400 })
  if (!currentPassword || typeof currentPassword !== 'string') return NextResponse.json({ error: 'Current password required' }, { status: 400 })

  const user = guard.session.user as { id?: string; role?: unknown }
  if (!user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const where = { id: user.id }
  const isStaff = resolvePinOwner(user.role) === 'staff'
  const actor = isStaff
    ? await prisma.staffUser.findFirst({ where, select: { id: true, name: true, email: true, password: true } })
    : await prisma.superAdmin.findFirst({ where, select: { id: true, name: true, email: true, password: true } })
  if (!actor?.password) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const validPassword = await bcrypt.compare(currentPassword, actor.password)
  if (!validPassword) return NextResponse.json({ error: 'Incorrect password' }, { status: 403 })

  const hashed = await bcrypt.hash(pin, 10)
  if (isStaff) await prisma.staffUser.update({ where: { id: actor.id }, data: { approvalPin: hashed } })
  else await prisma.superAdmin.update({ where: { id: actor.id }, data: { approvalPin: hashed } })

  logAudit({
    action: 'approval_pin_changed',
    entity: isStaff ? 'StaffUser' : 'SuperAdmin',
    entityId: actor.id,
    details: `${actor.name} (${actor.email}) changed their approval PIN`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true })
}
