import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { signCustomerToken, customerCookieOptions } from '@/lib/customer-auth'
import { recordDeviceSession } from '@/lib/device-session'
import { logAudit } from '@/lib/audit'
import { sendLoginAlert } from '@/lib/login-alert'
import {
  checkLoginThrottle,
  recordLoginFailure,
  clearLoginThrottle,
} from '@/lib/login-attempt'
import { formatRetryAfter } from '@/lib/login-throttle'

// A valid cost-10 bcrypt hash used to equalise response timing when the account
// doesn't exist, so an attacker can't tell real phones from fake ones by latency.
const DUMMY_HASH = '$2b$10$nUrpvJfq2cpE.r5D1xRM8eSGRAxC9l6SBOTjAkDncBZh8XCnlnhM6'

// The client IP, taken from the entry our own reverse proxy (nginx) appends to
// X-Forwarded-For — the RIGHTMOST value. The leftmost entries are client-supplied
// and forgeable, so using them would let an attacker both evade the IP rule and
// lock out arbitrary addresses. Assumes a single trusted proxy hop.
function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (!xff) return null
  const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
  const ip = parts[parts.length - 1]
  if (!ip || ip.length > 45) return null // 45 = max IPv6 textual length
  return ip
}

// The throttle must never take down login: if its DB access fails, fail OPEN
// rather than 500 the customer out. Rationale: this is one SQLite file — if it's
// truly unreachable the customer lookup below fails too, so the login is already
// broken and failing open opens no window that isn't already a full outage. A
// transient "database is locked" shouldn't reject a legitimate user. We log so
// the failure is never silent.
async function safeCheck(ids: { phone?: string | null; ip?: string | null }) {
  try {
    return await checkLoginThrottle(ids)
  } catch (e) {
    console.error('[login-throttle] check failed — failing open:', e)
    return { blocked: false, accountLocked: false, retryAfterSeconds: 0 }
  }
}
const swallow = (p: Promise<unknown>) =>
  p.catch((e) => console.error('[login-throttle] record/clear failed:', e))

// Account is hard-locked after too many failures — the client must run the OTP
// unlock flow (POST /api/customer/auth/unlock/request then /verify). 423 Locked.
function lockedResponse() {
  return NextResponse.json(
    {
      error: 'Your account is locked after too many failed attempts. Unlock it with a verification code to continue.',
      locked: true,
    },
    { status: 423 },
  )
}

export async function POST(req: NextRequest) {
  const { phone, password, app, deviceId: rawDeviceId, biometricToken: rawBiometricToken, device } = await req.json()
  // Strings only: these reach a Prisma where and the token hash.
  const deviceId = typeof rawDeviceId === 'string' ? rawDeviceId : ''
  const biometricToken = typeof rawBiometricToken === 'string' ? rawBiometricToken : ''
  if (!phone || typeof phone !== 'string') {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })
  }
  if (!password && !biometricToken) return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })

  const ip = clientIp(req)
  const isPasswordAttempt = !biometricToken && typeof password === 'string' && password.length > 0

  // Full freeze: once the account is hard-locked, EVERY method is refused
  // (password and biometric alike) until an OTP unlock. The IP spray rule is a
  // separate, time-based 429.
  const throttle = await safeCheck({ phone, ip })
  if (throttle.accountLocked) return lockedResponse()
  if (throttle.blocked) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${formatRetryAfter(throttle.retryAfterSeconds)}.` },
      { status: 429, headers: { 'Retry-After': String(throttle.retryAfterSeconds) } },
    )
  }

  // Record a failed password attempt, then return 423 if it just caused the lock
  // (so the client can jump to the unlock flow) or 401 otherwise. Applied
  // uniformly whether or not the account exists, so behaviour can't be used to
  // enumerate real phones.
  async function failPassword(): Promise<NextResponse> {
    await swallow(recordLoginFailure({ phone, ip }))
    const after = await safeCheck({ phone, ip })
    if (after.accountLocked) return lockedResponse()
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const customer = await prisma.customer.findFirst({
    where: { phone: phone.trim() },
  })

  if (!customer || !customer.password) {
    if (isPasswordAttempt) {
      await bcrypt.compare(password, DUMMY_HASH) // equalise timing vs. a real account
      return failPassword()
    }
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  let valid = false
  if (biometricToken && deviceId) {
    const hash = createHash('sha256').update(biometricToken).digest('hex')
    const t = await prisma.biometricToken.findFirst({
      where: { customerId: customer.id, deviceId, tokenHash: hash, revokedAt: null },
    })
    if (t) {
      valid = true
      await prisma.biometricToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
    }
  } else if (isPasswordAttempt) {
    valid = await bcrypt.compare(password, customer.password)
  }

  if (!valid) {
    if (isPasswordAttempt) return failPassword()
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  // Correct credentials: the throttle's job (protecting the password) is done,
  // so clear the account counter even if a later gate (status/device) blocks.
  await swallow(clearLoginThrottle({ phone }))

  if (customer.status && customer.status.toLowerCase() !== 'active') {
    return NextResponse.json({ error: 'Your account has been locked by the administrator. Please contact support.' }, { status: 403 })
  }

  if (app === 'customer' && deviceId) {
    if (!customer.boundDeviceId) {
      await prisma.customer.update({ where: { id: customer.id }, data: { boundDeviceId: deviceId } }).catch(() => {})
    } else if (customer.boundDeviceId !== deviceId) {
      return NextResponse.json({ error: 'This account is locked to another mobile device. Contact your agent to reset device binding.' }, { status: 403 })
    }
  }

  const token = await signCustomerToken({
    id: customer.id,
    customerId: customer.customerId,
    name: `${customer.firstName} ${customer.lastName}`,
    agentId: customer.agentId,
    tokenVersion: customer.tokenVersion,
  }, { loginAt: Math.floor(Date.now() / 1000) })

  const res = NextResponse.json({
    customerId: customer.customerId,
    name: `${customer.firstName} ${customer.lastName}`,
  })
  res.cookies.set(customerCookieOptions(token))

  logAudit({
    action: 'customer_login',
    entity: 'Customer',
    entityId: customer.id,
    details: `${customer.firstName} ${customer.lastName} (${customer.customerId}) logged in via ${biometricToken ? 'biometric' : 'password'}`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: `${customer.firstName} ${customer.lastName}`,
  })

  // Only an address the customer proved is theirs gets the alert (agent-typed emails are unverified).
  void sendLoginAlert({ email: customer.emailVerifiedAt ? customer.email : null, name: `${customer.firstName} ${customer.lastName}` }, biometricToken ? 'fingerprint' : 'password')

  if (app && deviceId) {
    recordDeviceSession({
      deviceId,
      app,
      customerId: customer.id,
      meta: device ?? undefined,
      ipAddress: ip,
    })
  }
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set({ name: 'customer_token', value: '', maxAge: 0, path: '/' })
  return res
}
