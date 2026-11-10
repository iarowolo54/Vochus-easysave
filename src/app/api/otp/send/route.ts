import { codeEmailMessage } from '@/lib/email-template'
import { randomInt, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendSMS } from '@/lib/kudisms'
import { sendMail } from '@/lib/mail'
import { logAudit } from '@/lib/audit'
import { hmacCode, readBody, text } from '@/lib/password-reset'
import { maskTarget } from '@/lib/unlock-otp'
import { clientIp, createRateLimiter } from '@/lib/rate-limit'

const TTL_MS = 10 * 60_000
const COOLDOWN_MS = 60_000
const DAY_MS = 24 * 60 * 60_000
const HOUR_MS = 60 * 60_000
const MAX_PER_PHONE_PER_DAY = 10
const MAX_PER_AGENT_PER_HOUR = 40
const MAX_PER_IP_PER_HOUR = 60
const AUDIT_ACTION = 'enrol_phone_code_sent'
// Per process, so up to double across PM2 instances. The phone and agent limits are in the database.
const limiter = createRateLimiter()

// Sends a paid SMS, so it needs an agent session. Only the agent enrolment screen calls it.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.agentId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const phone = text((await readBody(req)).phone).replace(/\s/g, '')
  if (!/^0[7-9][01]\d{8}$/.test(phone)) {
    return NextResponse.json({ error: 'Invalid Nigerian phone number' }, { status: 400 })
  }

  const ip = clientIp(req)
  if (ip !== 'unknown' && !limiter.check(`ip:${ip}`, MAX_PER_IP_PER_HOUR, HOUR_MS).allowed) {
    return NextResponse.json({ error: 'Too many codes sent. Please wait and try again.' }, { status: 429 })
  }

  const code = randomInt(100000, 1000000).toString()
  const id = randomUUID()
  const now = Date.now()
  const agentId = session.user.agentId
  // One statement, so concurrent requests can't both pass the limits.
  const inserted = await prisma.$executeRaw`
    INSERT INTO "PhoneOTP" ("id", "phone", "code", "expiresAt", "verified", "createdAt")
    SELECT ${id}, ${phone}, ${hmacCode('phone-otp', code)}, ${now + TTL_MS}, false, ${now}
    WHERE NOT EXISTS (SELECT 1 FROM "PhoneOTP" WHERE "phone" = ${phone} AND "createdAt" > ${now - COOLDOWN_MS})
    AND (SELECT COUNT(*) FROM "PhoneOTP" WHERE "phone" = ${phone} AND "createdAt" > ${now - DAY_MS}) < ${MAX_PER_PHONE_PER_DAY}
    AND (SELECT COUNT(*) FROM "AuditLog" WHERE "action" = ${AUDIT_ACTION} AND "actorId" = ${agentId} AND "createdAt" > ${now - HOUR_MS}) < ${MAX_PER_AGENT_PER_HOUR}`
  if (inserted !== 1) {
    return NextResponse.json({ error: 'A code was sent recently. Please wait and try again.' }, { status: 429 })
  }

  // Written before sending, because this row is what the per-agent cap counts.
  await logAudit({
    action: AUDIT_ACTION,
    entity: 'PhoneOTP',
    entityId: id,
    details: `Phone check code requested for ${maskTarget('sms', phone)}`,
    actorId: agentId,
    actorName: session.user.name ?? undefined,
  })

  // sms: registration phone check (agent enrolling a cash customer)
  const smsResult = await sendSMS(phone, `Your Vochus Easy Save verification code is: ${code}. Valid for 10 minutes.`)
  if (!smsResult.success) {
    // Keeps the row, so a failing send still counts toward the limits.
    await prisma.phoneOTP.update({ where: { id }, data: { expiresAt: new Date(now) } })
    return NextResponse.json({ error: 'The code couldn’t be sent. Try again.' }, { status: 500 })
  }

  const customer = await prisma.customer.findFirst({ where: { phone }, select: { email: true, emailVerifiedAt: true, firstName: true } })
  if (customer?.email && customer.emailVerifiedAt) {
    sendMail({
      to: customer.email,
      ...codeEmailMessage({
        subject: 'Your Vochus Easy Save verification code',
        preheader: 'Use this code to check your phone number.',
        heading: `Hi ${customer.firstName}, here is your code`,
        intro: 'Your verification code is:',
        code,
        caption: "It expires in 10 minutes. If you didn't request this, you can ignore this email.",
      }),
    }).catch(() => {})
  }

  // The code is delivered out-of-band (SMS, and email if the number is known).
  // It is never returned in the response or logged.
  return NextResponse.json({ ok: true })
}
