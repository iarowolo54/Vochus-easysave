import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pin, currentPassword } = await req.json()
  if (!pin || String(pin).length < 4) return NextResponse.json({ error: 'PIN must be at least 4 digits' }, { status: 400 })
  if (!currentPassword) return NextResponse.json({ error: 'Current password required' }, { status: 400 })

  const adminId = (session.user as any).id
  const adminEmail = (session.user as any).email
  const admin = await prisma.superAdmin.findFirst({ where: adminId ? { id: adminId } : { email: adminEmail } })
  if (!admin) return NextResponse.json({ error: 'Admin not found' }, { status: 404 })

  const validPassword = await bcrypt.compare(currentPassword, admin.password)
  if (!validPassword) return NextResponse.json({ error: 'Incorrect password' }, { status: 403 })

  const hashed = await bcrypt.hash(String(pin), 10)
  await prisma.superAdmin.update({ where: { id: admin.id }, data: { approvalPin: hashed } })

  logAudit({
    action: 'approval_pin_changed',
    entity: 'SuperAdmin',
    entityId: admin.id,
    details: `Admin ${admin.name} (${admin.email}) changed their approval PIN`,
    actorType: 'admin',
    actorId: admin.id,
    actorName: admin.name,
  })

  return NextResponse.json({ ok: true })
}
