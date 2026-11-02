import { NextRequest, NextResponse } from 'next/server'
import { randomInt, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { emailLogo } from '@/lib/email-brand'
import { enrolRateLimiter, clientIp } from '@/lib/rate-limit'
import { normalizeEmail } from '@/lib/email'

const SEND_MIN_INTERVAL_MS = 60 * 1000 // one send per email per 60s (DB-backed, cluster-safe)
const DAY_MS = 24 * 60 * 60_000
const MAX_SENDS_PER_DAY = 10

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

  // Exact 60s throttle per email, enforced from the DB (survives restarts and is
  // shared across both cluster instances). Checked BEFORE the hourly budget so a
  // user mashing "resend" within 60s doesn't burn their 5/hr allowance on sends
  // that never happen.
  const latest = await prisma.emailOTP.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } })
  if (latest && Date.now() - latest.createdAt.getTime() < SEND_MIN_INTERVAL_MS) {
    return NextResponse.json({ error: 'A code was just sent. Please wait a minute before requesting another.' }, { status: 429 })
  }

  // Per-email hourly soft limit (~5/hr) so one address can't be flooded. Only
  // counted once a send is actually going to happen.
  const hourLimit = enrolRateLimiter.check(`email-otp-send:email:${email}`, 5, 60 * 60 * 1000)
  if (!hourLimit.allowed) {
    return NextResponse.json({ error: 'Too many codes requested for this email. Please wait and try again.' }, { status: 429 })
  }

  const code = randomInt(100000, 1000000).toString()
  const id = randomUUID()
  const now = Date.now()
  // One statement, so concurrent requests can't pass the limits. Agent onboarding shares this table and
  // its daily count, so older rows are expired, never deleted: deleting them would reset that count.
  const inserted = await prisma.$executeRaw`
    INSERT INTO "EmailOTP" ("id", "email", "code", "expiresAt", "verified", "attempts", "createdAt")
    SELECT ${id}, ${email}, ${code}, ${now + 10 * 60_000}, false, 0, ${now}
    WHERE NOT EXISTS (SELECT 1 FROM "EmailOTP" WHERE "email" = ${email} AND "createdAt" > ${now - SEND_MIN_INTERVAL_MS})
    AND (SELECT COUNT(*) FROM "EmailOTP" WHERE "email" = ${email} AND "createdAt" > ${now - DAY_MS}) < ${MAX_SENDS_PER_DAY}`
  if (inserted !== 1) {
    return NextResponse.json({ error: 'Too many codes requested for this email. Please wait and try again.' }, { status: 429 })
  }
  await prisma.emailOTP.updateMany({
    where: { email, id: { not: id } },
    data: { expiresAt: new Date(now), verified: false },
  })

  // Fire-and-forget, as elsewhere in the app: the code is already persisted, so
  // a transient SMTP error shouldn't fail the request — the user can resend
  // after the throttle. Never block or leak the code on the response.
  sendMail({
    to: email,
    subject: 'Vochus Easy Save — Email Verification Code',
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:28px 20px;background:#f3f6f3">
        <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #d8e8dd">
          <div style="text-align:center;margin-bottom:20px">
            ${emailLogo()}
            <div style="font-size:18px;font-weight:900;margin-top:10px;color:#111">Vochus Easy Save</div>
          </div>
          <p style="font-size:14px;color:#444;margin:0 0 16px">Your email verification code is:</p>
          <div style="background:#e6f4ec;border-radius:12px;padding:18px;text-align:center;letter-spacing:8px;font-size:32px;font-weight:900;color:#1a6b3a;margin-bottom:16px;font-family:monospace">
            ${code}
          </div>
          <p style="font-size:12.5px;color:#888;margin:0">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
        </div>
      </div>
    `,
  }).catch(() => {})

  return NextResponse.json({ sent: true })
}
