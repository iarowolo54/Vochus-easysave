// Brute-force protection for the customer login path (phone + password).
//
// Pure decision logic — no DB, no clock, no I/O — so it is deterministic and
// unit-testable. The route/DB layers own persistence and supply `now`.
//
// Two independent concerns:
//
//  1. Per-account HARD LOCK (the client's rule): after ACCOUNT_FAIL_LIMIT failed
//     password attempts the account is locked. There is NO time-based unlock —
//     the only way back in is an email/SMS OTP (see login-attempt.unlockAccount).
//     While unlocked, the failure counter resets after a quiet window so a few
//     scattered typos over a long day don't accumulate into a lock.
//
//  2. Per-IP spray rule (defence in depth): a loose, TIME-based lock that only
//     trips after many failures across accounts from one IP — deliberately high
//     so shared carrier IPs (CGNAT) aren't caught. This still uses lockedUntil.

export interface AttemptState {
  failCount: number
  lastFailAt: number | null
  lockedUntil: number | null
}

export const THROTTLE = {
  // While an account is still UNLOCKED, a failure after this much quiet starts a
  // fresh count — so unrelated typos hours apart don't stack up to a lock.
  resetAfterMs: 30 * 60_000,
}

// -------- Per-account hard lock --------

export const ACCOUNT_FAIL_LIMIT = 4

/** An account is locked once it has reached the failure limit. Cleared only by a
 *  successful OTP unlock (or a successful login), never by the passage of time. */
export function isAccountLocked(failCount: number): boolean {
  return failCount >= ACCOUNT_FAIL_LIMIT
}

/** The failure count after one more failed password attempt, resetting the
 *  window after `resetAfterMs` of quiet. Used only while still unlocked. */
export function nextFailCount(state: AttemptState, now: number): number {
  const windowExpired =
    state.lastFailAt == null || now - state.lastFailAt > THROTTLE.resetAfterMs
  return windowExpired ? 1 : state.failCount + 1
}

// -------- Per-IP spray rule (time based) --------

/**
 * Lock duration for the Nth failure seen from a single IP across ALL accounts.
 * Deliberately loose: many legitimate users share one carrier IP (CGNAT), so
 * this only fires on egregious spraying.
 */
export function ipLockDurationMs(failCount: number): number {
  return failCount < 20 ? 0 : 15 * 60_000
}

/** Pure read of a TIME-based lock (the IP rule): is it currently locked? */
export function checkThrottle(
  state: AttemptState,
  now: number,
): { blocked: boolean; retryAfterSeconds: number } {
  if (state.lockedUntil && state.lockedUntil > now) {
    return { blocked: true, retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000) }
  }
  return { blocked: false, retryAfterSeconds: 0 }
}

/** Next state after a failed attempt for a TIME-based key (the IP rule). */
export function registerFailure(
  state: AttemptState,
  now: number,
  schedule: (failCount: number) => number,
): AttemptState {
  const windowExpired =
    state.lastFailAt == null || now - state.lastFailAt > THROTTLE.resetAfterMs
  const failCount = windowExpired ? 1 : state.failCount + 1
  const dur = schedule(failCount)
  return { failCount, lastFailAt: now, lockedUntil: dur > 0 ? now + dur : null }
}

/** Human-friendly Retry-After text (used for the IP-rule message). */
export function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}
