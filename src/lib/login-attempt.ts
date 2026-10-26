// DB-backed persistence for the customer login throttle. Stores one row per
// throttle key in the LoginAttempt table; the decision logic is the pure module
// in ./login-throttle. SQLite serialises writes, so the read-modify-write below
// is safe enough for a throttle (a rare lost increment only undercounts, and the
// window keeps climbing anyway).
import { prisma } from './prisma'
import {
  checkThrottle,
  registerFailure,
  lockDurationMs,
  ipLockDurationMs,
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

async function saveState(key: string, s: AttemptState): Promise<void> {
  const data = {
    failCount: s.failCount,
    lastFailAt: toDate(s.lastFailAt),
    lockedUntil: toDate(s.lockedUntil),
  }
  await prisma.loginAttempt.upsert({
    where: { key },
    create: { key, ...data },
    update: data,
  })
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
  if (phone) {
    const key = phoneKey(phone)
    await saveState(key, registerFailure(await loadState(key), now, lockDurationMs))
  }
  if (ip) {
    const key = ipKey(ip)
    await saveState(key, registerFailure(await loadState(key), now, ipLockDurationMs))
  }
}

/** Clear the account throttle on a successful login. The IP key is left alone so
 *  a legitimate login can't be used to reset an IP-wide spray counter. */
export async function clearLoginThrottle({ phone }: { phone?: string | null }): Promise<void> {
  if (phone) await prisma.loginAttempt.deleteMany({ where: { key: phoneKey(phone) } })
}
