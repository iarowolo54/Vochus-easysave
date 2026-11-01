import { NextRequest, NextResponse } from 'next/server'
import { encode } from 'next-auth/jwt'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { pickIdentity } from '@/lib/admin-identity'
import { requireEnv } from '@/lib/env'
import { IDLE_SECONDS } from '@/lib/session-policy'

const COOKIE_NAME = 'next-admin-auth.session-token'
const SECRET = requireEnv('NEXTAUTH_SECRET')

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const admin = await prisma.superAdmin.findUnique({ where: { email: normalizedEmail } })
  // Only consult StaffUser when no SuperAdmin owns this email (never shadowed).
  const staff = admin ? null : await prisma.staffUser.findUnique({ where: { email: normalizedEmail } })

  const identity = pickIdentity({ superAdmin: admin, staff })
  const hash = identity.kind === 'superadmin' ? admin?.password : identity.kind === 'staff' ? staff?.password : undefined

  if (identity.kind === 'none' || !hash || !(await bcrypt.compare(password, hash))) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  const role = identity.kind === 'staff' ? 'staff' : 'superadmin'
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
