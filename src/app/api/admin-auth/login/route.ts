import { NextRequest, NextResponse } from 'next/server'
import { encode } from 'next-auth/jwt'
import { logAudit } from '@/lib/audit'
import { adminIpFromForwarded, verifyAdminLogin } from '@/lib/admin-login-guard'
import { requireEnv } from '@/lib/env'
import { IDLE_SECONDS } from '@/lib/session-policy'

const COOKIE_NAME = 'next-admin-auth.session-token'
const SECRET = requireEnv('NEXTAUTH_SECRET')

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })
  }

  const result = await verifyAdminLogin(email, password, adminIpFromForwarded(req.headers.get('x-forwarded-for')))
  if (result.kind === 'locked') {
    return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429 })
  }
  if (result.kind === 'invalid') {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }
  const { admin } = result

  const token = await encode({
    token: { sub: admin.id, email: admin.email, name: admin.name, role: 'superadmin', loginAt: Math.floor(Date.now() / 1000) },
    secret: SECRET,
    maxAge: IDLE_SECONDS.admin,
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
    maxAge: IDLE_SECONDS.admin,
  })
  return res
}
