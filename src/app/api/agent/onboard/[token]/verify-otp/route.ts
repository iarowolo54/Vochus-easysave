import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { SIX_DIGITS, readBody, sameCode, text } from '@/lib/password-reset'

const MAX_ATTEMPTS = 5

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = await prisma.agentInvite.findUnique({ where: { token } })
  if (!invite || invite.status === 'Completed' || invite.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 })
  }

  const code = text((await readBody(req)).code)
  if (!code) return NextResponse.json({ error: 'Code required' }, { status: 400 })
  if (!SIX_DIGITS.test(code)) return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })

  const otp = await prisma.emailOTP.findFirst({
    where: { email: invite.email, verified: false, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  if (!otp) return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })

  // Reserve the attempt and enforce the cap in one statement, so a concurrent burst can't get free guesses.
  const reserved = await prisma.emailOTP.updateMany({
    where: { id: otp.id, verified: false, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  })
  if (reserved.count === 0) {
    return NextResponse.json({ error: 'Too many incorrect attempts. Request a new code.' }, { status: 400 })
  }
  if (!sameCode(otp.code, code)) return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })

  await prisma.emailOTP.update({ where: { id: otp.id }, data: { verified: true } })

  return NextResponse.json({ verified: true })
}
