import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enrolRateLimiter, clientIp } from '@/lib/rate-limit'

// Convenience check for the enrol page: does a phone already have an account?
// It returns ONLY a boolean (no customer details), and it is NOT the guard —
// the real duplicate check stays in POST /api/customer/enroll (409). Because it
// tells anyone whether a number is registered, it is rate-limited per IP.
export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const limit = enrolRateLimiter.check(`phone-available:ip:${ip}`, 10, 60 * 1000)
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 })
  }

  const { phone } = await req.json()
  if (typeof phone !== 'string' || !/^0\d{10}$/.test(phone)) {
    return NextResponse.json({ error: 'Enter an 11-digit phone number starting with 0' }, { status: 400 })
  }

  const existing = await prisma.customer.findFirst({ where: { phone }, select: { id: true } })
  return NextResponse.json({ available: !existing })
}
