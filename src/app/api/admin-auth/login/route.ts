import { NextRequest, NextResponse } from 'next/server'
import { encode } from 'next-auth/jwt'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

const COOKIE_NAME = 'next-admin-auth.session-token'
const SECRET = process.env.NEXTAUTH_SECRET ?? 'vochus-easy-save-secret-dev-2026'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })
  }

  const admin = await prisma.superAdmin.findUnique({
    where: { email: email.trim().toLowerCase() },
  })

  if (!admin || !(await bcrypt.compare(password, admin.password))) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  const token = await encode({
    token: { sub: admin.id, email: admin.email, name: admin.name, role: 'superadmin' },
    secret: SECRET,
  })

  logAudit({
    action: 'admin_login',
    entity: 'SuperAdmin',
    entityId: admin.id,
    details: `Admin ${admin.name} (${admin.email}) logged in`,
    actorType: 'admin',
    actorId: admin.id,
    actorName: admin.name,
  })

  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}
