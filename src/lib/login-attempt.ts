// DB-backed persistence for the customer login throttle (one row per key in the
// LoginAttempt table). Decision logic is the pure module in ./login-throttle.
//
// Two key kinds:
//  - "phone:<phone>"  — per-account HARD LOCK. Locked once failCount reaches the
//    limit; cleared only by unlockAccount() (OTP) or a successful login. No time
//    expiry. lockedUntil is unused for these rows.
//  - "ip:<addr>"      — per-IP spray rule, a loose TIME lock via lockedUntil.
import { prisma } from './prisma'
import {
  checkThrottle,
  ipLockDurationMs,
  isAccountLocked,
  ACCOUNT_FAIL_LIMIT,
  THROTTLE,
  type AttemptState,
} from './login-throttle'

const EMPTY: AttemptState = { failCount: 0, lastFailAt: null, lockedUntil: null }

const phoneKey = (phone: string) => `phone:${phone.trim()}`
const ipKey = (ip: string) => `ip:${ip}`
const toDate = (n: number | null) => (n == null ? null : new Date(n))

export interface ThrottleResult {
  blocked: boolean // any lock active (account hard lock OR ip spray lock)
  accountLocked: boolean // the per-account hard lock — needs an OTP unlock
  retryAfterSeconds: number // for the IP time lock
}

async function loadState(key: string): Promise<AttemptState> {
  const row = await prisma.loginAttempt.findUnique({ where: { key } })
  if (!row) return EMPTY
  return {
    failCount: row.failCount,
    lastFailAt: row.lastFailAt ? row.lastFailAt.getTime() : null,
    lockedUntil: row.lockedUntil ? row.lockedUntil.getTime() : null,
  }
}

/** Reset a key to a fresh first-failure window (absolute values). */
async function startWindow(key: string, now: number, lockedUntil: number | null): Promise<void> {
  const data = { failCount: 1, lastFailAt: toDate(now), lockedUntil: toDate(lockedUntil) }
  await prisma.loginAttempt.upsert({ where: { key }, create: { key, ...data }, update: data })
}

// -------- Per-account hard lock --------

/** Record a failed password attempt against an account. Once the account is
 *  locked (failCount >= limit) further failures are ignored — it stays locked
 *  until an OTP unlock. The increment is atomic so a concurrent burst can't be
 *  lost. Account rows never set lockedUntil. */
async function accountBump(key: string, now: number): Promise<void> {
  const prior = await prisma.loginAttempt.findUnique({ where: { key } })
  if (prior && isAccountLocked(prior.failCount)) return // already locked; nothing to do

  const windowExpired =
    prior?.lastFailAt != null && now - prior.lastFailAt.getTime() > THROTTLE.resetAfterMs
  if (!prior || prior.failCount === 0 || windowExpired) {
    await startWindow(key, now, null)
    return
  }
  try {
    await prisma.loginAttempt.update({
      where: { key },
      data: { failCount: { increment: 1 }, lastFailAt: toDate(now) },
    })
  } catch {
    await startWindow(key, now, null) // row vanished (concurrent success/unlock)
  }
}

/** Clear an account's lock + counter — on a successful login or a verified OTP. */
export async function unlockAccount(phone: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { key: phoneKey(phone) } })
}

/** Is this account currently hard-locked? (Used by the OTP-request endpoint.) */
export async function isPhoneLocked(phone: string): Promise<boolean> {
  const s = await loadState(phoneKey(phone))
  return isAccountLocked(s.failCount)
}

// -------- Per-IP spray rule (time based) --------

async function ipBump(key: string, now: number): Promise<void> {
  const prior = await prisma.loginAttempt.findUnique({ where: { key } })
  const windowExpired =
    prior?.lastFailAt != null && now - prior.lastFailAt.getTime() > THROTTLE.resetAfterMs
  if (!prior || prior.failCount === 0 || windowExpired) {
    await startWindow(key, now, ipLockDurationMs(1) > 0 ? now + ipLockDurationMs(1) : null)
    return
  }
  let failCount: number
  try {
    const row = await prisma.loginAttempt.update({
      where: { key },
      data: { failCount: { increment: 1 }, lastFailAt: toDate(now) },
    })
    failCount = row.failCount
  } catch {
    await startWindow(key, now, null)
    return
  }
  const dur = ipLockDurationMs(failCount)
  await prisma.loginAttempt
    .update({ where: { key }, data: { lockedUntil: dur > 0 ? toDate(now + dur) : null } })
    .catch(() => {})
}

// -------- Reserved attempts with a time lock (admin sign-in) --------

const RESERVE_RETRY_MS = 150

/**
 * Count an attempt BEFORE checking the password, so a parallel burst can't all pass a lock check that no failure has
 * reached yet: at most `limit` attempts ever get to the password check per window. A lock that has ended, or a quiet
 * window, starts the count again. Refund the attempt if it turns out to be a success.
 */
export async function reserveAttempt(
  key: string, limit: number, lockMs: number, now: number = Date.now(),
): Promise<{ allowed: boolean; startedLock: boolean }> {
  // Once more on a brief "database is locked" (2 PM2 instances share this file), or if the sweep removed the row.
  try {
    const first = await reserveOnce(key, limit, lockMs, now)
    if (first) return first
  } catch {
    await new Promise(resolve => setTimeout(resolve, RESERVE_RETRY_MS))
  }
  const second = await reserveOnce(key, limit, lockMs, now)
  if (!second) throw new Error('attempt row keeps disappearing')
  return second
}

async function reserveOnce(
  key: string, limit: number, lockMs: number, now: number,
): Promise<{ allowed: boolean; startedLock: boolean } | null> {
  const nowDate = toDate(now)!
  await prisma.loginAttempt.upsert({ where: { key }, create: { key, failCount: 0 }, update: {} }).catch((e: unknown) => {
    // Two first attempts at once: the other one created the row.
    if ((e as { code?: unknown } | null)?.code !== 'P2002') throw e
  })
  await prisma.loginAttempt.updateMany({
    where: { key, OR: [{ lockedUntil: { lte: nowDate } }, { lockedUntil: null, lastFailAt: { lt: toDate(now - THROTTLE.resetAfterMs)! } }] },
    data: { failCount: 0, lockedUntil: null },
  })
  // One statement, so it holds across PM2 instances: each attempt gets its own count, and the limit-th sets the lock in
  // the same write. Separate steps let a burst count past the limit before any of them read it, so none ran and no lock
  // was ever set. Dates are epoch ms, which is how Prisma stores DateTime in this SQLite file.
  const rows = await prisma.$queryRaw<{ failCount: number | bigint }[]>`
    UPDATE "LoginAttempt"
    SET "failCount" = "failCount" + 1,
        "lastFailAt" = ${now},
        "updatedAt" = ${now},
        "lockedUntil" = CASE WHEN "failCount" + 1 >= ${limit} THEN ${now + lockMs} ELSE "lockedUntil" END
    WHERE "key" = ${key} AND "lockedUntil" IS NULL
    RETURNING "failCount"`
  if (rows.length === 0) {
    // No row matched: it's locked, or it's gone. Only a row that's there is a lock.
    const row = await prisma.loginAttempt.findUnique({ where: { key }, select: { id: true } })
    return row ? { allowed: false, startedLock: false } : null
  }
  return { allowed: true, startedLock: Number(rows[0].failCount) === limit }
}

/** Give back a reserved attempt, and any lock it started. */
export async function refundAttempt(key: string, startedLock: boolean): Promise<void> {
  await prisma.loginAttempt.updateMany({
    where: { key, failCount: { gt: 0 } },
    data: { failCount: { decrement: 1 }, ...(startedLock ? { lockedUntil: null } : {}) },
  })
}

// -------- Public API --------

/** Blocked if the account is hard-locked OR the IP is spray-locked. */
export async function checkLoginThrottle(
  { phone, ip }: { phone?: string | null; ip?: string | null },
  now: number = Date.now(),
): Promise<ThrottleResult> {
  let accountLocked = false
  let retryAfterSeconds = 0
  if (phone) {
    const s = await loadState(phoneKey(phone))
    accountLocked = isAccountLocked(s.failCount)
  }
  if (ip) {
    const r = checkThrottle(await loadState(ipKey(ip)), now)
    if (r.blocked) retryAfterSeconds = r.retryAfterSeconds
  }
  return { blocked: accountLocked || retryAfterSeconds > 0, accountLocked, retryAfterSeconds }
}

/** Record a failed login against the account (hard-lock) and IP (spray) keys. */
export async function recordLoginFailure(
  { phone, ip }: { phone?: string | null; ip?: string | null },
  now: number = Date.now(),
): Promise<void> {
  if (phone) await accountBump(phoneKey(phone), now)
  if (ip) await ipBump(ipKey(ip), now)
  if (Math.random() < 0.02) void sweepStaleLoginAttempts(now).catch(() => {})
}

/** Clear the account lock on a successful login. The IP key is left alone so a
 *  legitimate login can't reset an IP-wide spray counter. */
export async function clearLoginThrottle({ phone }: { phone?: string | null }): Promise<void> {
  if (phone) await unlockAccount(phone)
}

/** Delete abandoned rows (time-stale and not currently locked) so the table
 *  doesn't grow unbounded under spraying. A LOCKED account is never swept — it
 *  must persist until its OTP unlock. */
export async function sweepStaleLoginAttempts(now: number = Date.now()): Promise<number> {
  const res = await prisma.loginAttempt.deleteMany({
    where: {
      AND: [
        { OR: [{ lockedUntil: null }, { lockedUntil: { lt: toDate(now)! } }] },
        // A row with no failure yet is left alone until it's old: it may be an attempt being counted this moment.
        { OR: [{ lastFailAt: { lt: toDate(now - THROTTLE.resetAfterMs)! } }, { lastFailAt: null, updatedAt: { lt: toDate(now - THROTTLE.resetAfterMs)! } }] },
        // never sweep a hard-locked account
        { NOT: { AND: [{ key: { startsWith: 'phone:' } }, { failCount: { gte: ACCOUNT_FAIL_LIMIT } }] } },
      ],
    },
  })
  return res.count
}
