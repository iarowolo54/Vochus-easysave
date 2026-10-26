// Brute-force throttle for the customer login path (phone + password).
//
// Pure decision logic — no DB, no clock, no I/O — so it is deterministic and
// unit-testable. The route layer owns persistence (one row per throttle key in
// the LoginAttempt table) and supplies `now`; this module only decides.
//
// Design (see the escalating schedule below):
//  - Escalating DELAY, never a permanent lock — a real customer who forgets
//    their password just waits; an attacker cannot lock a victim out for good.
//  - The counter keeps climbing as long as attempts keep coming inside the
//    reset window, so a sustained attack stays locked at 15m. After a quiet
//    `resetAfterMs` the window starts fresh, giving honest users a clean slate.

export interface AttemptState {
  failCount: number
  lastFailAt: number | null
  lockedUntil: number | null
}

export const THROTTLE = {
  // After this much quiet (no failures), the next failure starts a new window.
  resetAfterMs: 30 * 60_000,
}

/** Lock duration for the Nth consecutive failure in the current window. */
export function lockDurationMs(failCount: number): number {
  if (failCount < 5) return 0
  if (failCount <= 7) return failCount === 5 ? 30_000 : 60_000 // 5 -> 30s, 6-7 -> 1m
  if (failCount <= 9) return 5 * 60_000 // 8-9 -> 5m
  return 15 * 60_000 // 10+ -> 15m
}

/**
 * Lock duration for the Nth failure seen from a single IP across ALL accounts.
 * Deliberately loose: many legitimate users share one carrier IP (CGNAT), so
 * this only fires on egregious spraying, and never on the handful of failures a
 * few honest users behind the same IP would produce.
 */
export function ipLockDurationMs(failCount: number): number {
  return failCount < 20 ? 0 : 15 * 60_000
}

/** Pure read: is this key currently locked, and for how much longer? */
export function checkThrottle(
  state: AttemptState,
  now: number,
): { blocked: boolean; retryAfterSeconds: number } {
  if (state.lockedUntil && state.lockedUntil > now) {
    return { blocked: true, retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000) }
  }
  return { blocked: false, retryAfterSeconds: 0 }
}

/** Human-friendly Retry-After text for a login error message. */
export function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

/**
 * Compute the next state after a failed login attempt. `schedule` maps the
 * running failure count to a lock duration — defaults to the per-account
 * escalation; pass `ipLockDurationMs` for the per-IP spray rule.
 */
export function registerFailure(
  state: AttemptState,
  now: number,
  schedule: (failCount: number) => number = lockDurationMs,
): AttemptState {
  const windowExpired =
    state.lastFailAt == null || now - state.lastFailAt > THROTTLE.resetAfterMs
  const failCount = windowExpired ? 1 : state.failCount + 1
  const dur = schedule(failCount)
  return {
    failCount,
    lastFailAt: now,
    lockedUntil: dur > 0 ? now + dur : null,
  }
}
