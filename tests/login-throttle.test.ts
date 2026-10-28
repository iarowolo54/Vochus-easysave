import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  THROTTLE,
  ACCOUNT_FAIL_LIMIT,
  isAccountLocked,
  nextFailCount,
  ipLockDurationMs,
  checkThrottle,
  registerFailure,
  formatRetryAfter,
  type AttemptState,
} from '../src/lib/login-throttle'

const t0 = 1_000_000_000_000
const fresh: AttemptState = { failCount: 0, lastFailAt: null, lockedUntil: null }

// --- Account hard lock (per-phone) ---

test('account locks at exactly the 4th failure, not before', () => {
  assert.equal(ACCOUNT_FAIL_LIMIT, 4)
  assert.equal(isAccountLocked(0), false)
  assert.equal(isAccountLocked(3), false)
  assert.equal(isAccountLocked(4), true)
  assert.equal(isAccountLocked(9), true)
})

test('nextFailCount climbs within the window and resets after inactivity', () => {
  let count = 0
  let state: AttemptState = { ...fresh }
  let now = t0
  for (let i = 0; i < 4; i++) {
    now += 1000
    count = nextFailCount(state, now)
    state = { failCount: count, lastFailAt: now, lockedUntil: null }
  }
  assert.equal(count, 4)
  assert.equal(isAccountLocked(count), true)

  // A failure after a long quiet period starts a fresh window at 1.
  const later = now + THROTTLE.resetAfterMs + 1
  assert.equal(nextFailCount(state, later), 1)
})

test('four scattered typos within the window still lock', () => {
  let state: AttemptState = { ...fresh }
  let now = t0
  for (let i = 0; i < 4; i++) {
    now += 60_000 // one typo a minute — inside the reset window
    const c = nextFailCount(state, now)
    state = { failCount: c, lastFailAt: now, lockedUntil: null }
  }
  assert.equal(isAccountLocked(state.failCount), true)
})

// --- IP spray rule (per-IP, time based) — unchanged ---

test('IP rule stays quiet until 20 failures, then 15m', () => {
  assert.equal(ipLockDurationMs(4), 0)
  assert.equal(ipLockDurationMs(19), 0)
  assert.equal(ipLockDurationMs(20), 15 * 60_000)
})

test('registerFailure drives the IP time-lock and checkThrottle reads it', () => {
  let s = fresh
  let now = t0
  for (let i = 0; i < 20; i++) {
    now += 1000
    s = registerFailure(s, now, ipLockDurationMs)
  }
  assert.equal(s.lockedUntil, now + 15 * 60_000)
  assert.equal(checkThrottle(s, now + 1000).blocked, true)
  assert.equal(checkThrottle(s, now + 15 * 60_000 + 1).blocked, false)
})

test('formatRetryAfter renders friendly, pluralised durations', () => {
  assert.equal(formatRetryAfter(1), '1 second')
  assert.equal(formatRetryAfter(30), '30 seconds')
  assert.equal(formatRetryAfter(60), '1 minute')
  assert.equal(formatRetryAfter(90), '2 minutes')
})
