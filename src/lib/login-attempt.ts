// DB-backed persistence for the customer login throttle. Stores one row per
// throttle key in the LoginAttempt table; the decision logic is the pure module
// in ./login-throttle. SQLite serialises writes, so the read-modify-write below
// is safe enough for a throttle (a rare lost increment only undercounts, and the
// window keeps climbing anyway).
import { prisma } from './prisma'
import {
  checkThrottle,
  lockDurationMs,
  ipLockDurationMs,
  THROTTLE,
  type AttemptState,
} from './login-throttle'

const EMPTY: AttemptState = { failCount: 0, lastFailAt: null, lockedUntil: null }

const phoneKey = (phone: string) => `phone:${phone.trim()}`
const ipKey = (ip: string) => `ip:${ip}`
const toDate = (n: number | null) => (n == null ? null : new Date(n))

export interface ThrottleResult {
  blocked: boolean
  retryAfterSeconds: number
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

/** Set a key to a fresh (first-failure) window with absolute values. Used only
 *  when no active window exists; a lost increment here is immaterial (far from
 *  any lock), so it needs no atomicity. */
async function startWindow(key: string, now: number, dur: number): Promise<void> {
  const data = {
    failCount: 1,
    lastFailAt: toDate(now),
    lockedUntil: dur > 0 ? toDate(now + dur) : null,
  }
  await prisma.loginAttempt.upsert({ where: { key }, create: { key, ...data }, update: data })
}

/** Record one failure against a key, escalating per `schedule`. The increment is
 *  atomic (`increment: 1`) so a burst of concurrent failures can't be lost — the
 *  TOCTOU gap in a read-modify-write would otherwise hand an attacker many free
 *  guesses per window. */
async function bumpFailure(
  key: string,
  now: number,
  schedule: (failCount: number) => number,
): Promise<void> {
  const prior = await prisma.loginAttempt.findUnique({ where: { key } })
  const windowExpired =
    prior?.lastFailAt != null && now - prior.lastFailAt.getTime() > THROTTLE.resetAfterMs

  if (!prior || prior.failCount === 0 || windowExpired) {
    await startWindow(key, now, schedule(1))
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
    // Row vanished between read and write (e.g. cleared by a concurrent success).
    await startWindow(key, now, schedule(1))
    return
  }

  const dur = schedule(failCount)
  await prisma.loginAttempt
    .update({ where: { key }, data: { lockedUntil: dur > 0 ? toDate(now + dur) : null } })
    .catch(() => {})
}

/** Is this login currently throttled? Blocked if the account OR the IP is locked. */
export async function checkLoginThrottle(
  { phone, ip }: { phone?: string | null; ip?: string | null },
  now: number = Date.now(),
): Promise<ThrottleResult> {
  let blocked = false
  let retryAfterSeconds = 0
  const keys = [phone ? phoneKey(phone) : null, ip ? ipKey(ip) : null].filter(
    (k): k is string => k != null,
  )
  for (const key of keys) {
    const r = checkThrottle(await loadState(key), now)
    if (r.blocked) {
      blocked = true
      retryAfterSeconds = Math.max(retryAfterSeconds, r.retryAfterSeconds)
    }
  }
  return { blocked, retryAfterSeconds }
}

/** Record a failed login against both the account (escalating) and IP (spray) keys. */
export async function recordLoginFailure(
  { phone, ip }: { phone?: string | null; ip?: string | null },
  now: number = Date.now(),
): Promise<void> {
  if (phone) await bumpFailure(phoneKey(phone), now, lockDurationMs)
  if (ip) await bumpFailure(ipKey(ip), now, ipLockDurationMs)
  // Opportunistic, fire-and-forget cleanup so the table self-maintains without a
  // cron job. Rare enough to add negligible write contention.
  if (Math.random() < 0.02) void sweepStaleLoginAttempts(now).catch(() => {})
}

/** Clear the account throttle on a successful login. The IP key is left alone so
 *  a legitimate login can't be used to reset an IP-wide spray counter. */
export async function clearLoginThrottle({ phone }: { phone?: string | null }): Promise<void> {
  if (phone) await prisma.loginAttempt.deleteMany({ where: { key: phoneKey(phone) } })
}

/** Delete rows that are no longer locked AND whose window has fully expired —
 *  they would reset on the next failure anyway. Keeps the table from growing
 *  unbounded under spraying (failures against random/forged phones + IPs).
 *  Call from a cron/maintenance task, or rely on the opportunistic sweep below. */
export async function sweepStaleLoginAttempts(now: number = Date.now()): Promise<number> {
  const res = await prisma.loginAttempt.deleteMany({
    where: {
      AND: [
        { OR: [{ lockedUntil: null }, { lockedUntil: { lt: toDate(now)! } }] },
        { OR: [{ lastFailAt: null }, { lastFailAt: { lt: toDate(now - THROTTLE.resetAfterMs)! } }] },
      ],
    },
  })
  return res.count
}
