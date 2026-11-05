import { NextRequest, NextResponse } from 'next/server'
import { sendEmailCode } from '@/lib/email-code'
import { enrolRateLimiter, clientIp } from '@/lib/rate-limit'
import { normalizeEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  const { email: rawEmail } = await req.json()
  if (!rawEmail || typeof rawEmail !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }
  const email = normalizeEmail(rawEmail)

  // Per-IP soft limit (best-effort across the cluster): bounds a single source
  // fanning out across many addresses, and bounds the DB read below.
  const ip = clientIp(req)
  const ipLimit = enrolRateLimiter.check(`email-otp-send:ip:${ip}`, 20, 60 * 60 * 1000)
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const sent = await sendEmailCode(email)
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status })
  return NextResponse.json({ sent: true })
}
