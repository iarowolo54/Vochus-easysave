// The emailed 6-digit code used to prove an address. One place, so enrolment and "confirm my email for alerts"
// share the same throttles. Rows live in EmailOTP; older rows are expired, never deleted, because agent onboarding
// shares this table and its daily count.
import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { codeEmailMessage } from '@/lib/email-template'
import { enrolRateLimiter } from '@/lib/rate-limit'

const SEND_MIN_INTERVAL_MS = 60 * 1000
const DAY_MS = 24 * 60 * 60_000
const MAX_SENDS_PER_DAY = 10
const MAX_TRIES = 5

export type CodeResult = { ok: true } | { ok: false; status: number; error: string }
const TOO_MANY = 'Too many codes requested for this email. Please wait and try again.'

/** `email` must already be normalised. */
export async function sendEmailCode(email: string): Promise<CodeResult> {
  // Exact 60s throttle from the DB (shared by both cluster instances), checked before the hourly budget.
  const latest = await prisma.emailOTP.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } })
  if (latest && Date.now() - latest.createdAt.getTime() < SEND_MIN_INTERVAL_MS) {
    return { ok: false, status: 429, error: 'A code was just sent. Please wait a minute before requesting another.' }
  }
  if (!enrolRateLimiter.check(`email-otp-send:email:${email}`, 5, 60 * 60 * 1000).allowed) return { ok: false, status: 429, error: TOO_MANY }

  const code = randomInt(100000, 1000000).toString()
  const id = randomUUID()
  const now = Date.now()
  // One statement, so concurrent requests can't pass the limits.
  const inserted = await prisma.$executeRaw`
    INSERT INTO "EmailOTP" ("id", "email", "code", "expiresAt", "verified", "attempts", "createdAt")
    SELECT ${id}, ${email}, ${code}, ${now + 10 * 60_000}, false, 0, ${now}
    WHERE NOT EXISTS (SELECT 1 FROM "EmailOTP" WHERE "email" = ${email} AND "createdAt" > ${now - SEND_MIN_INTERVAL_MS})
    AND (SELECT COUNT(*) FROM "EmailOTP" WHERE "email" = ${email} AND "createdAt" > ${now - DAY_MS}) < ${MAX_SENDS_PER_DAY}`
  if (inserted !== 1) return { ok: false, status: 429, error: TOO_MANY }
  await prisma.emailOTP.updateMany({ where: { email, id: { not: id } }, data: { expiresAt: new Date(now), verified: false } })

  // The code is already stored, so a transient SMTP error doesn't fail the request; the user can resend.
  sendMail({
    to: email,
    ...codeEmailMessage({
      subject: 'Vochus Easy Save — Email Verification Code',
      preheader: 'Enter this code to confirm your email address.',
      heading: 'Confirm your email',
      intro: 'Your email verification code is:',
      code,
      caption: 'This code expires in 10 minutes. Do not share it with anyone.',
    }),
  }).catch(() => {})
  return { ok: true }
}

/**
 * Checks a typed code against the newest live code for this address. A right code is used up (expired) and not
 * marked verified, so it can't also pass the sign-up gate. Wrong tries are counted and the code dies after five.
 */
export async function checkEmailCode(email: string, typed: string): Promise<CodeResult> {
  const row = await prisma.emailOTP.findFirst({ where: { email, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } })
  const bad = { ok: false as const, status: 400, error: 'That code isn’t right, or it has expired. Check it, or ask for a new one.' }
  if (!row || row.verified || row.attempts >= MAX_TRIES) return bad
  const a = Buffer.from(row.code), b = Buffer.from(typed)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await prisma.emailOTP.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } })
    return bad
  }
  // Only one caller can use it up.
  const used = await prisma.emailOTP.updateMany({ where: { id: row.id, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date() } })
  return used.count === 1 ? { ok: true } : bad
}
