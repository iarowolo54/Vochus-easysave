// One-time codes for forgot-password and agent unlock, which both set a new password.
//
// Security posture (see .claude/rules/auth-security.md):
//  - Only a SHA-256 hash is stored; the code is never persisted, logged or returned to a caller.
//  - One live code per account, single use, limited wrong guesses, compared in constant time.
//  - Attempts and send limits live in the database, so they hold across PM2 instances and restarts.
//  - Separate from PhoneOTP/EmailOTP, so a code from enrolment or onboarding can't reset a password.
//
// Limits are generous because market customers may share a phone or a mobile network. Wrong guesses
// never block the account for long: a new code is available after the cooldown.
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from './prisma'
import { logAudit } from './audit'
import { clientIp, createRateLimiter } from './rate-limit'
import { generateCode, hashCode } from './unlock-otp'

export const OTP_TTL_MS = 10 * 60_000
export const MAX_VERIFY_ATTEMPTS = 5
export const RESEND_COOLDOWN_MS = 60_000
export const MAX_SENDS_PER_DAY = 10
export const IP_REQUESTS_PER_HOUR = 30
export const IP_GUESSES_PER_15_MIN = 60

const DAY_MS = 24 * 60 * 60_000
const HOUR_MS = 60 * 60_000
const FIFTEEN_MIN_MS = 15 * 60_000

export type ResetActor = 'customer' | 'agent'
export type ResetPurpose = 'reset' | 'unlock'

// Per process, so a caller spread across both PM2 instances gets up to twice this. That's fine for
// a soft network-level cap; the exact limits are the per-account ones above, held in the database.
const ipLimiter = createRateLimiter()

export function resetIpLimiterForTests() {
  ipLimiter.reset()
}

/** A 429 if this IP is over its budget, otherwise null. An unidentified IP isn't limited: those would all share one budget. */
export function limitByIp(req: Request, kind: 'request' | 'guess', now: number = Date.now()): NextResponse | null {
  const ip = clientIp(req)
  if (ip === 'unknown') return null
  const r = kind === 'request'
    ? ipLimiter.check(`reset-request:${ip}`, IP_REQUESTS_PER_HOUR, HOUR_MS, now)
    : ipLimiter.check(`reset-guess:${ip}`, IP_GUESSES_PER_15_MIN, FIFTEEN_MIN_MS, now)
  if (r.allowed) return null
  return NextResponse.json(
    { error: 'Too many attempts. Please wait a few minutes and try again.' },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(r.retryAfterMs / 1000))) } },
  )
}

/**
 * Creates the account's one live code and retires any older ones. Returns null while the account is
 * in its cooldown or over its daily cap; the earlier code stays valid, and callers answer the same
 * way either way so the response doesn't reveal that the account exists.
 */
export async function issueResetCode(
  actorType: ResetActor,
  actorId: string,
  now: number = Date.now(),
  purpose: ResetPurpose = 'reset',
): Promise<{ id: string; code: string } | null> {
  const code = generateCode()
  const id = randomUUID()
  // One statement, so concurrent requests can't both pass the cooldown and daily cap.
  const inserted = await prisma.$executeRaw`
    INSERT INTO "PasswordResetOtp" ("id", "actorType", "actorId", "purpose", "codeHash", "expiresAt", "attempts", "createdAt")
    SELECT ${id}, ${actorType}, ${actorId}, ${purpose}, ${hashCode(code)}, ${now + OTP_TTL_MS}, 0, ${now}
    WHERE NOT EXISTS (
      SELECT 1 FROM "PasswordResetOtp"
      WHERE "actorType" = ${actorType} AND "actorId" = ${actorId} AND "createdAt" > ${now - RESEND_COOLDOWN_MS}
    )
    AND (
      SELECT COUNT(*) FROM "PasswordResetOtp"
      WHERE "actorType" = ${actorType} AND "actorId" = ${actorId} AND "createdAt" > ${now - DAY_MS}
    ) < ${MAX_SENDS_PER_DAY}`
  if (inserted !== 1) {
    await auditDailyCap(actorType, actorId, now)
    return null
  }

  await prisma.passwordResetOtp.updateMany({
    where: { actorType, actorId, consumedAt: null, id: { not: id } },
    data: { consumedAt: new Date(now) },
  })
  return { id, code }
}

/** Records that an account hit its daily cap, at most once a day, so an admin can see why someone isn't getting codes. */
async function auditDailyCap(actorType: ResetActor, actorId: string, now: number) {
  const since = new Date(now - DAY_MS)
  const sent = await prisma.passwordResetOtp.count({ where: { actorType, actorId, createdAt: { gt: since } } })
  if (sent < MAX_SENDS_PER_DAY) return
  const logged = await prisma.auditLog.findFirst({
    where: { action: 'password_reset_daily_cap', entityId: actorId, createdAt: { gt: since } },
    select: { id: true },
  })
  if (logged) return
  await logAudit({
    action: 'password_reset_daily_cap',
    entity: actorType === 'customer' ? 'Customer' : 'Agent',
    entityId: actorId,
    details: `Password reset codes stopped after ${MAX_SENDS_PER_DAY} sends in 24 hours`,
    actorType,
    actorId,
  })
}

/**
 * Sends the code without making the caller wait, so a known account doesn't answer slower than an
 * unknown one. A failed send cancels the code but keeps the row, so it still counts toward the limits.
 */
export function deliverInBackground(rowId: string, send: () => Promise<boolean>) {
  void send()
    .catch(() => false)
    .then(async (ok) => {
      if (ok) return
      console.error('Password reset code could not be delivered')
      await prisma.passwordResetOtp.updateMany({ where: { id: rowId, consumedAt: null }, data: { consumedAt: new Date() } })
    })
    .catch(() => {})
}

function matches(storedHash: string, code: string) {
  const a = Buffer.from(storedHash)
  const b = Buffer.from(hashCode(code))
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Constant-time compare for the older tables that store a code as plain text. */
export function sameCode(stored: string, code: string) {
  return matches(hashCode(stored), code)
}

export const SIX_DIGITS = /^\d{6}$/

/** Checks a code against the account's live code, consuming it on success. All failures look the same to the caller. */
export async function verifyResetCode(
  actorType: ResetActor,
  actorId: string,
  code: string,
  now: number = Date.now(),
  purpose: ResetPurpose = 'reset',
): Promise<boolean> {
  const at = new Date(now)
  const otp = await prisma.passwordResetOtp.findFirst({
    where: { actorType, actorId, purpose, consumedAt: null, expiresAt: { gt: at } },
    orderBy: { createdAt: 'desc' },
  })
  if (!otp) return false

  // Reserve the attempt and enforce the cap in one statement, so a concurrent burst can't get free guesses.
  const reserved = await prisma.passwordResetOtp.updateMany({
    where: { id: otp.id, consumedAt: null, attempts: { lt: MAX_VERIFY_ATTEMPTS }, expiresAt: { gt: at } },
    data: { attempts: { increment: 1 } },
  })
  if (reserved.count === 0) return false

  if (!matches(otp.codeHash, code)) {
    const spent = await prisma.passwordResetOtp.updateMany({
      where: { id: otp.id, consumedAt: null, attempts: { gte: MAX_VERIFY_ATTEMPTS } },
      data: { consumedAt: at },
    })
    if (spent.count === 1) {
      await prisma.passwordResetOtp.updateMany({ where: { actorType, actorId, consumedAt: null }, data: { consumedAt: at } })
      await logAudit({
        action: 'password_reset_locked',
        entity: actorType === 'customer' ? 'Customer' : 'Agent',
        entityId: actorId,
        details: `Password reset code cancelled after ${MAX_VERIFY_ATTEMPTS} wrong attempts`,
        actorType,
        actorId,
      })
    }
    return false
  }

  // Single use, even under concurrent requests. Retires any other live code too.
  const consumed = await prisma.passwordResetOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: at } })
  if (consumed.count !== 1) return false
  await prisma.passwordResetOtp.updateMany({ where: { actorType, actorId, consumedAt: null }, data: { consumedAt: at } })
  return true
}

export const INVALID_CODE_MESSAGE = 'That code didn’t work or has expired. Check it, or request a new one.'

/** Reads a request body as a plain object; a malformed body gives an empty one. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await req.json().catch(() => null)
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
