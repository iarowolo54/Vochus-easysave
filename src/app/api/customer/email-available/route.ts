import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enrolRateLimiter, clientIp } from '@/lib/rate-limit'
import { findIdentityConflict } from '@/lib/identity'

// Convenience check for the enrol page, like phone-available: is this email already used by an account?
// It returns ONLY a boolean, and it is NOT the guard — the real duplicate check stays in
// POST /api/customer/enroll (409). It tells anyone whether an email is registered, so it is rate-limited per IP.
export async function POST(req: NextRequest) {
  const limit = enrolRateLimiter.check(`email-available:ip:${clientIp(req)}`, 10, 60 * 1000)
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 })
  }

  const body: unknown = await req.json().catch(() => null)
  const email = body && typeof body === 'object' && 'email' in body ? (body as { email: unknown }).email : null
  if (typeof email !== 'string' || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  const conflict = await findIdentityConflict(prisma, { email })
  return NextResponse.json({ available: conflict !== 'email' })
}
