import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { signCustomerToken, customerCookieOptions } from '@/lib/customer-auth'
import { recordDeviceSession } from '@/lib/device-session'
import { logAudit } from '@/lib/audit'
import {
  checkLoginThrottle,
  recordLoginFailure,
  clearLoginThrottle,
} from '@/lib/login-attempt'
import { formatRetryAfter } from '@/lib/login-throttle'

export async function POST(req: NextRequest) {
  const { phone, password, app, deviceId, biometricToken, device } = await req.json()
  if (!phone) return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })
  if (!password && !biometricToken) return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null

  // Brute-force throttle gate — generic, time-based message that does not reveal
  // whether the account exists.
  const throttle = await checkLoginThrottle({ phone, ip })
  if (throttle.blocked) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${formatRetryAfter(throttle.retryAfterSeconds)}.` },
      { status: 429, headers: { 'Retry-After': String(throttle.retryAfterSeconds) } },
    )
  }

  const customer = await prisma.customer.findFirst({
    where: { phone: phone.trim() },
  })

  if (!customer || !customer.password) {
    await recordLoginFailure({ phone, ip })
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
  } else if (password) {
    valid = await bcrypt.compare(password, customer.password)
  }

  if (!valid) {
    await recordLoginFailure({ phone, ip })
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  // Correct credentials: the throttle's job (protecting the password) is done,
  // so clear the account counter even if a later gate (status/device) blocks.
  await clearLoginThrottle({ phone })

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
  })

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

  if (app && deviceId) {
    recordDeviceSession({
      deviceId,
      app,
      customerId: customer.id,
      meta: device ?? undefined,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    })
  }
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set({ name: 'customer_token', value: '', maxAge: 0, path: '/' })
  return res
}
