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
import { timingSafeEqual } from 'node:crypto'
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
): Promise<{ id: string; code: string } | null> {
  const where = { actorType, actorId }
  const last = await prisma.passwordResetOtp.findFirst({ where, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
  if (last && now - last.createdAt.getTime() < RESEND_COOLDOWN_MS) return null

  const sentToday = await prisma.passwordResetOtp.count({ where: { ...where, createdAt: { gt: new Date(now - DAY_MS) } } })
  if (sentToday >= MAX_SENDS_PER_DAY) return null

  const code = generateCode()
  const [, row] = await prisma.$transaction([
    prisma.passwordResetOtp.updateMany({ where: { ...where, consumedAt: null }, data: { consumedAt: new Date(now) } }),
    prisma.passwordResetOtp.create({
      data: { ...where, codeHash: hashCode(code), expiresAt: new Date(now + OTP_TTL_MS), createdAt: new Date(now) },
      select: { id: true },
    }),
  ])
  return { id: row.id, code }
}

/**
 * Sends the code without making the caller wait, so a known account doesn't answer slower than an
 * unknown one. A failed send gives back the cooldown and daily slot.
 */
export function deliverInBackground(rowId: string, send: () => Promise<boolean>) {
  void send()
    .catch(() => false)
    .then(async (ok) => {
      if (ok) return
      console.error('Password reset code could not be delivered')
      await prisma.passwordResetOtp.deleteMany({ where: { id: rowId } })
    })
    .catch(() => {})
}

function matches(storedHash: string, code: string) {
  const a = Buffer.from(storedHash)
  const b = Buffer.from(hashCode(code))
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Checks a code against the account's live code, consuming it on success. All failures look the same to the caller. */
export async function verifyResetCode(
  actorType: ResetActor,
  actorId: string,
  code: string,
  now: number = Date.now(),
): Promise<boolean> {
  const at = new Date(now)
  const otp = await prisma.passwordResetOtp.findFirst({
    where: { actorType, actorId, consumedAt: null, expiresAt: { gt: at } },
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
