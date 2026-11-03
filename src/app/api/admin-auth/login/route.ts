import { NextRequest, NextResponse } from 'next/server'
import { encode } from 'next-auth/jwt'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { verifyAdminLogin } from '@/lib/admin-login-guard'
import { rightmostForwardedIp } from '@/lib/rate-limit'
import { requireEnv } from '@/lib/env'
import { IDLE_SECONDS } from '@/lib/session-policy'

const COOKIE_NAME = 'next-admin-auth.session-token'
const SECRET = requireEnv('NEXTAUTH_SECRET')

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })
  }

  const result = await verifyAdminLogin(email, password, rightmostForwardedIp(req.headers.get('x-forwarded-for')))
  if (result.kind === 'locked') {
    return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429 })
  }
  if (result.kind === 'invalid') {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }
  const identity = result.kind === 'ok-staff'
    ? { kind: 'staff' as const, id: result.staff.id, name: result.staff.name, email: result.staff.email }
    : { kind: 'superadmin' as const, id: result.admin.id, name: result.admin.name, email: result.admin.email }
  const admin = result.kind === 'ok' ? result.admin : null

  const role = identity.kind
  const token = await encode({
    token: { sub: identity.id, email: identity.email, name: identity.name, role, loginAt: Math.floor(Date.now() / 1000) },
    secret: SECRET,
    maxAge: IDLE_SECONDS.admin,
  })

  if (identity.kind === 'staff') {
    // Best-effort: a locked SQLite write must never fail a valid login.
    try {
      await prisma.staffUser.update({ where: { id: identity.id }, data: { lastActiveAt: new Date() } })
    } catch (err) {
      console.error('admin-auth login: failed to update lastActiveAt', err instanceof Error ? err.message : err)
    }
    logAudit({
      action: 'admin_login',
      entity: 'StaffUser',
      entityId: identity.id!,
      details: `Staff ${identity.name} (${identity.email}) logged in`,
      actorType: 'staff',
      actorId: identity.id,
      actorName: identity.name,
    })
  } else {
    logAudit({
      action: 'admin_login',
      entity: 'SuperAdmin',
      entityId: admin!.id,
      details: `Admin ${admin!.name} (${admin!.email}) logged in`,
      actorType: 'admin',
      actorId: admin!.id,
      actorName: admin!.name,
    })
  }

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
