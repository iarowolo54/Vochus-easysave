// One-time codes for forgot-password and agent unlock, which both set a new password, and for
// customer login unlock, which only clears the lock.
//
// Security posture (see .claude/rules/auth-security.md):
//  - Only an HMAC of the code is stored; the code is never persisted, logged or returned to a caller.
//  - Each code is bound to an opaque resetId given only to whoever requested it, so a stranger's wrong
//    guesses can't cancel the owner's code, and a stranger's request doesn't retire it.
//  - Limited wrong guesses per code, single use, compared in constant time.
//  - Attempts and send limits live in the database, so they hold across PM2 instances and restarts.
//  - Separate from PhoneOTP/EmailOTP, so a code from enrolment or onboarding can't reset a password.
//
// Limits are generous because market customers may share a phone or a mobile network. The cooldown and
// daily cap count per account and IP, so one IP can't hold an account's limit against its owner. Many IPs
// can still reach the overall ceiling; an admin can send a code past it (issueAdminResetCode).
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from './prisma'
import { logAudit } from './audit'
import { requireEnv } from './env'
import { clientIp, createRateLimiter } from './rate-limit'

export const OTP_TTL_MS = 10 * 60_000
export const MAX_VERIFY_ATTEMPTS = 5
export const RESEND_COOLDOWN_MS = 60_000
export const MAX_SENDS_PER_DAY = 10 // per account and IP
export const MAX_ACCOUNT_SENDS_PER_DAY = 40
export const MAX_FAILED_GUESSES_PER_DAY = 50
export const LOCK_SPIKE_PER_HOUR = 20
export const GUESS_ALARM_PER_HOUR = 200
export const IP_REQUESTS_PER_HOUR = 30
export const IP_GUESSES_PER_15_MIN = 60

const DAY_MS = 24 * 60 * 60_000
const HOUR_MS = 60 * 60_000
const FIFTEEN_MIN_MS = 15 * 60_000

/** Keyed hash, so a leaked database doesn't let anyone test the million possible codes. Throws if the secret is missing. */
export function hmacCode(kind: string, code: string) {
  return createHmac('sha256', requireEnv('NEXTAUTH_SECRET')).update(`${kind}:${code}`).digest('hex')
}

const hashResetCode = (code: string) => hmacCode('password-reset-otp', code)

export function newResetId() {
  return randomBytes(16).toString('hex')
}

export type ResetActor = 'customer' | 'agent'
export type ResetPurpose = 'reset' | 'unlock' | 'admin' | 'login_unlock' | 'password_change'

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

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
 * Creates a new code without touching any older ones, so a stranger's request can't retire the owner's.
 * Returns null while the account is in its cooldown or over its daily cap, and on any error; callers
 * answer the same way either way, so the response doesn't reveal that the account exists.
 */
export async function issueResetCode(
  actorType: ResetActor,
  actorId: string,
  now: number = Date.now(),
  purpose: ResetPurpose = 'reset',
  ip: string = 'unknown',
): Promise<{ id: string; code: string; resetId: string } | null> {
  try {
    const ipHash = ip === 'unknown' ? null : hmacCode('reset-ip', ip)
    const code = generateCode()
    const id = randomUUID()
    const resetId = newResetId()
    // One statement, so concurrent requests can't both pass the cooldown and daily cap.
    const inserted = await prisma.$executeRaw`
      INSERT INTO "PasswordResetOtp" ("id", "actorType", "actorId", "purpose", "resetId", "requestIpHash", "codeHash", "expiresAt", "attempts", "createdAt")
      SELECT ${id}, ${actorType}, ${actorId}, ${purpose}, ${resetId}, ${ipHash}, ${hashResetCode(code)}, ${now + OTP_TTL_MS}, 0, ${now}
      WHERE NOT EXISTS (
        SELECT 1 FROM "PasswordResetOtp"
        WHERE "actorType" = ${actorType} AND "actorId" = ${actorId} AND "purpose" = ${purpose} AND "requestIpHash" IS ${ipHash} AND "createdAt" > ${now - RESEND_COOLDOWN_MS}
      )
      AND (
        SELECT COUNT(*) FROM "PasswordResetOtp"
        WHERE "actorType" = ${actorType} AND "actorId" = ${actorId} AND "purpose" = ${purpose} AND "requestIpHash" IS ${ipHash} AND "createdAt" > ${now - DAY_MS}
      ) < ${MAX_SENDS_PER_DAY}
      AND (
        SELECT COUNT(*) FROM "PasswordResetOtp"
        WHERE "actorType" = ${actorType} AND "actorId" = ${actorId} AND "purpose" = ${purpose} AND "createdAt" > ${now - DAY_MS}
      ) < ${MAX_ACCOUNT_SENDS_PER_DAY}`
    if (inserted !== 1) {
      await auditDailyCap(actorType, actorId, purpose, ipHash, now)
      return null
    }
    return { id, code, resetId }
  } catch {
    console.error('Password reset code could not be issued')
    return null
  }
}

/** A code requested by an admin. Skips the cooldown and daily cap, and doesn't count toward them or the guess ceiling. */
export async function issueAdminResetCode(actorType: ResetActor, actorId: string, now: number = Date.now()) {
  const code = generateCode()
  const resetId = newResetId()
  const row = await prisma.passwordResetOtp.create({
    data: { actorType, actorId, purpose: 'admin', resetId, codeHash: hashResetCode(code), expiresAt: new Date(now + OTP_TTL_MS), createdAt: new Date(now) },
    select: { id: true },
  })
  return { id: row.id, code, resetId }
}

export async function cancelResetCode(id: string) {
  await prisma.passwordResetOtp.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } })
}

/** Records that an account hit its daily cap, at most once a day, so an admin can see why someone isn't getting codes. */
async function auditDailyCap(actorType: ResetActor, actorId: string, purpose: ResetPurpose, ipHash: string | null, now: number) {
  const since = new Date(now - DAY_MS)
  const account = { actorType, actorId, purpose, createdAt: { gt: since } }
  const fromIp = await prisma.passwordResetOtp.count({ where: { ...account, requestIpHash: ipHash } })
  if (fromIp < MAX_SENDS_PER_DAY && (await prisma.passwordResetOtp.count({ where: account })) < MAX_ACCOUNT_SENDS_PER_DAY) return
  const logged = await prisma.auditLog.findFirst({
    where: { action: 'password_reset_daily_cap', entityId: actorId, createdAt: { gt: since } },
    select: { id: true },
  })
  if (logged) return
  await logAudit({
    action: 'password_reset_daily_cap',
    entity: actorType === 'customer' ? 'Customer' : 'Agent',
    entityId: actorId,
    details: `Password reset codes stopped at the daily limit (${MAX_SENDS_PER_DAY} per IP, ${MAX_ACCOUNT_SENDS_PER_DAY} per account)`,
    actorType,
    actorId,
  })
}

/**
 * Sends the code without making the caller wait, so a known account doesn't answer slower than an
 * unknown one. A failed send cancels only this code, and the row still counts toward the limits.
 */
export function deliverInBackground(rowId: string, send: () => Promise<boolean>): Promise<void> {
  return send()
    .catch(() => false)
    .then(async (ok) => {
      if (ok) return
      console.error('Password reset code could not be delivered')
      await cancelResetCode(rowId)
    })
    .catch(() => {})
}

export function sameHash(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Constant-time compare for the older tables that store a code as plain text. */
export function sameCode(stored: string, code: string) {
  return sameHash(stored, code)
}

export const SIX_DIGITS = /^\d{6}$/

async function auditOnce(action: string, actorType: ResetActor | null, actorId: string | null, details: string, sinceMs: number, now: number) {
  const logged = await prisma.auditLog.findFirst({
    where: { action, ...(actorId ? { entityId: actorId } : {}), createdAt: { gt: new Date(now - sinceMs) } },
    select: { id: true },
  })
  if (logged) return
  await logAudit({
    action,
    entity: actorType === 'agent' ? 'Agent' : actorType === 'customer' ? 'Customer' : 'PasswordResetOtp',
    entityId: actorId ?? undefined,
    details,
    actorType: actorType ?? 'system',
    actorId: actorId ?? undefined,
  })
}

/**
 * Checks a code against the row its resetId names, consuming it on success, and returns the purpose of the
 * row it matched. All failures look the same to the caller.
 */
export async function redeemResetCode(
  actorType: ResetActor,
  actorId: string,
  resetId: string,
  code: string,
  now: number = Date.now(),
  purpose: ResetPurpose = 'reset',
): Promise<ResetPurpose | null> {
  if (!resetId) return null
  const at = new Date(now)
  const otp = await prisma.passwordResetOtp.findFirst({
    where: {
      actorType, actorId, resetId, consumedAt: null, expiresAt: { gt: at },
      // An admin-sent code is used on the normal reset screen.
      purpose: purpose === 'reset' ? { in: ['reset', 'admin'] } : purpose,
    },
  })
  if (!otp) return null

  if (otp.purpose !== 'admin') {
    const guessed = await prisma.passwordResetOtp.aggregate({
      where: { actorType, actorId, purpose: otp.purpose, createdAt: { gt: new Date(now - DAY_MS) } },
      _sum: { attempts: true },
    })
    if ((guessed._sum.attempts ?? 0) >= MAX_FAILED_GUESSES_PER_DAY) {
      await auditOnce('password_reset_guess_ceiling', actorType, actorId, `Password reset guesses stopped after ${MAX_FAILED_GUESSES_PER_DAY} in 24 hours`, DAY_MS, now)
      return null
    }
    // Guessing across many accounts: each code gets one try until it calms down. A first try is never
    // refused and admin codes are exempt, so a stranger causing this can't stop anyone using a code they have.
    if (otp.attempts >= 1) {
      const recent = await prisma.passwordResetOtp.aggregate({
        where: { purpose: { not: 'admin' }, createdAt: { gt: new Date(now - HOUR_MS), lte: at } },
        _sum: { attempts: true },
      })
      if ((recent._sum.attempts ?? 0) >= GUESS_ALARM_PER_HOUR) {
        await auditOnce('password_reset_guess_alarm', null, null, `Over ${GUESS_ALARM_PER_HOUR} code guesses in an hour across all accounts; each code now gets one try`, HOUR_MS, now)
        return null
      }
    }
  }

  // Reserve the attempt and enforce the cap in one statement, so a concurrent burst can't get free guesses.
  const reserved = await prisma.passwordResetOtp.updateMany({
    where: { id: otp.id, consumedAt: null, attempts: { lt: MAX_VERIFY_ATTEMPTS }, expiresAt: { gt: at } },
    data: { attempts: { increment: 1 } },
  })
  if (reserved.count === 0) return null

  if (!sameHash(otp.codeHash, hashResetCode(code))) {
    const spent = await prisma.passwordResetOtp.updateMany({
      where: { id: otp.id, consumedAt: null, attempts: { gte: MAX_VERIFY_ATTEMPTS } },
      data: { consumedAt: at },
    })
    if (spent.count === 1) {
      await logAudit({
        action: 'password_reset_locked',
        entity: actorType === 'customer' ? 'Customer' : 'Agent',
        entityId: actorId,
        details: `Password reset code cancelled after ${MAX_VERIFY_ATTEMPTS} wrong attempts`,
        actorType,
        actorId,
      })
      // No alerting exists, so a spike across all accounts shows up as its own audit entry, at most once an hour.
      const hourAgo = new Date(now - HOUR_MS)
      const locks = await prisma.auditLog.count({ where: { action: 'password_reset_locked', createdAt: { gt: hourAgo } } })
      if (locks >= LOCK_SPIKE_PER_HOUR) {
        await auditOnce('password_reset_lock_spike', null, null, `${locks} password reset codes cancelled for wrong guesses in the last hour`, HOUR_MS, now)
      }
    }
    return null
  }

  // Single use, even under concurrent requests. A successful reset retires every other live code too.
  const consumed = await prisma.passwordResetOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: at } })
  if (consumed.count !== 1) return null
  // A new password ends every other live code on the account, whatever its purpose; a login unlock sets
  // no password, so it ends only other unlock codes. The code was right, so a failure here mustn't fail
  // the reset; the others expire within minutes anyway.
  await prisma.passwordResetOtp
    .updateMany({ where: { actorType, actorId, consumedAt: null, ...(otp.purpose === 'login_unlock' ? { purpose: 'login_unlock' } : {}) }, data: { consumedAt: at } })
    .catch(() => console.error('Older password reset codes could not be retired'))
  return otp.purpose as ResetPurpose
}

export async function verifyResetCode(
  actorType: ResetActor,
  actorId: string,
  resetId: string,
  code: string,
  now: number = Date.now(),
  purpose: ResetPurpose = 'reset',
): Promise<boolean> {
  return (await redeemResetCode(actorType, actorId, resetId, code, now, purpose)) !== null
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
