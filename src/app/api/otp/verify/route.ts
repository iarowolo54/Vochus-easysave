import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SIX_DIGITS, hmacCode, readBody, sameHash, text } from '@/lib/password-reset'
import { clientIp, createRateLimiter } from '@/lib/rate-limit'

const FIFTEEN_MIN_MS = 15 * 60_000
// Per process: PhoneOTP has no attempts column, so this is a soft cap, up to double across PM2 instances.
const guesses = createRateLimiter()

// Only the agent enrolment screen calls this.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.agentId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await readBody(req)
  const phone = text(body.phone)
  const code = text(body.code)
  if (!phone || !SIX_DIGITS.test(code)) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  const ip = clientIp(req)
  const byPhone = guesses.check(`phone:${phone}`, 10, FIFTEEN_MIN_MS)
  const byIp = ip === 'unknown' ? byPhone : guesses.check(`ip:${ip}`, 60, FIFTEEN_MIN_MS)
  if (!byPhone.allowed || !byIp.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429 })
  }

  const otps = await prisma.phoneOTP.findMany({
    where: { phone, verified: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  const hashed = hmacCode('phone-otp', code)
  const otp = otps.find(o => sameHash(o.code, hashed))
  if (!otp) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  await prisma.phoneOTP.update({ where: { id: otp.id }, data: { verified: true } })

  return NextResponse.json({ ok: true })
}
