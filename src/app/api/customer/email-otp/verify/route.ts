import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { enrolRateLimiter, clientIp } from '@/lib/rate-limit'
import { normalizeEmail } from '@/lib/email'

const MAX_ATTEMPTS = 5

function codesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export async function POST(req: NextRequest) {
  const { email: rawEmail, code } = await req.json()
  if (!rawEmail || !code) {
    return NextResponse.json({ error: 'Email and code required' }, { status: 400 })
  }
  const email = normalizeEmail(String(rawEmail))

  // Per-IP soft limit so one source can't grind codes for many addresses.
  const ip = clientIp(req)
  const ipLimit = enrolRateLimiter.check(`email-otp-verify:ip:${ip}`, 30, 10 * 60 * 1000)
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 })
  }

  // Look the code up by EMAIL only — never put the submitted code in the where,
  // so comparison is explicit and constant-time.
  const otp = await prisma.emailOTP.findFirst({
    where: { email, verified: false, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: 'desc' },
  })

  if (!otp) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  // Reserve one attempt ATOMICALLY before comparing, so concurrent requests
  // can't exceed the cap (no read-then-write race). A failed reservation means
  // the code is already burned (>= MAX_ATTEMPTS) or verified.
  const reserved = await prisma.emailOTP.updateMany({
    where: { id: otp.id, verified: false, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  })
  if (reserved.count === 0) {
    return NextResponse.json({ error: 'Too many incorrect attempts. Request a new code.' }, { status: 400 })
  }

  if (!codesMatch(String(code), otp.code)) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  await prisma.emailOTP.update({ where: { id: otp.id }, data: { verified: true } })
  return NextResponse.json({ verified: true })
}
