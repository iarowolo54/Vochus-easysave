import { codeEmailMessage } from '@/lib/email-template'
import { NextRequest, NextResponse } from 'next/server'
import { randomInt, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'

const COOLDOWN_MS = 60_000
const DAY_MS = 24 * 60 * 60_000
const MAX_PER_DAY = 10

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = await prisma.agentInvite.findUnique({ where: { token } })
  if (!invite || invite.status === 'Completed' || invite.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 })
  }

  const code = randomInt(100000, 1000000).toString()
  const id = randomUUID()
  const now = Date.now()
  // One statement, so concurrent requests can't pass the limits. Older rows stay, so a resend can't reset them.
  const inserted = await prisma.$executeRaw`
    INSERT INTO "EmailOTP" ("id", "email", "code", "expiresAt", "verified", "attempts", "createdAt")
    SELECT ${id}, ${invite.email}, ${code}, ${now + 10 * 60_000}, false, 0, ${now}
    WHERE NOT EXISTS (SELECT 1 FROM "EmailOTP" WHERE "email" = ${invite.email} AND "createdAt" > ${now - COOLDOWN_MS})
    AND (SELECT COUNT(*) FROM "EmailOTP" WHERE "email" = ${invite.email} AND "createdAt" > ${now - DAY_MS}) < ${MAX_PER_DAY}`
  if (inserted !== 1) {
    return NextResponse.json({ error: 'A code was sent recently. Please wait a minute and try again.' }, { status: 429 })
  }
  // Only the newest code stays live.
  await prisma.emailOTP.updateMany({
    where: { email: invite.email, verified: false, id: { not: id } },
    data: { expiresAt: new Date(now) },
  })

  await sendMail({
    to: invite.email,
    ...codeEmailMessage({
      subject: 'Your Vochus Easy Save verification code',
      preheader: 'Use this code to verify your email address.',
      heading: 'Confirm your email',
      intro: 'Use the code below to verify your email address during agent onboarding.',
      code,
      caption: 'This code expires in 10 minutes. Do not share it with anyone.',
      audience: 'agent',
    }),
  })

  return NextResponse.json({ sent: true })
}
