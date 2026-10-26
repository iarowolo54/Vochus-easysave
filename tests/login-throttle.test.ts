import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  THROTTLE,
  lockDurationMs,
  ipLockDurationMs,
  checkThrottle,
  registerFailure,
  formatRetryAfter,
  type AttemptState,
} from '../src/lib/login-throttle'

test('formatRetryAfter renders friendly, pluralised durations', () => {
  assert.equal(formatRetryAfter(1), '1 second')
  assert.equal(formatRetryAfter(30), '30 seconds')
  assert.equal(formatRetryAfter(60), '1 minute')
  assert.equal(formatRetryAfter(90), '2 minutes')
  assert.equal(formatRetryAfter(300), '5 minutes')
})

const t0 = 1_000_000_000_000 // fixed "now" for determinism
const fresh: AttemptState = { failCount: 0, lastFailAt: null, lockedUntil: null }

test('no lock below the threshold', () => {
  assert.equal(lockDurationMs(0), 0)
  assert.equal(lockDurationMs(4), 0)
})

test('escalating schedule: 5->30s, 6-7->1m, 8-9->5m, 10+->15m', () => {
  assert.equal(lockDurationMs(5), 30_000)
  assert.equal(lockDurationMs(6), 60_000)
  assert.equal(lockDurationMs(7), 60_000)
  assert.equal(lockDurationMs(8), 5 * 60_000)
  assert.equal(lockDurationMs(9), 5 * 60_000)
  assert.equal(lockDurationMs(10), 15 * 60_000)
  assert.equal(lockDurationMs(50), 15 * 60_000)
})

test('four failures in a row do not lock', () => {
  let s = fresh
  let now = t0
  for (let i = 0; i < 4; i++) {
    now += 1000
    s = registerFailure(s, now)
  }
  assert.equal(s.failCount, 4)
  assert.equal(s.lockedUntil, null)
  assert.equal(checkThrottle(s, now).blocked, false)
})

test('fifth failure locks for 30s and checkThrottle reports Retry-After', () => {
  let s = fresh
  let now = t0
  for (let i = 0; i < 5; i++) {
    now += 1000
    s = registerFailure(s, now)
  }
  assert.equal(s.failCount, 5)
  assert.equal(s.lockedUntil, now + 30_000)

  const during = checkThrottle(s, now + 10_000)
  assert.equal(during.blocked, true)
  assert.equal(during.retryAfterSeconds, 20) // 30s lock, 10s elapsed

  const after = checkThrottle(s, now + 30_001)
  assert.equal(after.blocked, false)
})

test('counter keeps climbing while attempts stay within the reset window', () => {
  let s = fresh
  let now = t0
  for (let i = 0; i < 10; i++) {
    now += 1000
    s = registerFailure(s, now)
  }
  assert.equal(s.failCount, 10)
  assert.equal(s.lockedUntil, now + 15 * 60_000)
})

test('inactivity past the reset window starts a fresh window', () => {
  let s = fresh
  let now = t0
  for (let i = 0; i < 6; i++) {
    now += 1000
    s = registerFailure(s, now)
  }
  assert.equal(s.failCount, 6)
  // come back after the reset window of quiet
  now += THROTTLE.resetAfterMs + 1
  s = registerFailure(s, now)
  assert.equal(s.failCount, 1)
  assert.equal(s.lockedUntil, null)
})

test('IP schedule stays quiet well past the per-account threshold', () => {
  // Shared carrier IPs / CGNAT: many real users behind one IP. The IP rule must
  // not trip at a handful of failures the way the per-account rule does.
  assert.equal(ipLockDurationMs(5), 0)
  assert.equal(ipLockDurationMs(10), 0)
  assert.equal(ipLockDurationMs(19), 0)
  assert.equal(ipLockDurationMs(20), 15 * 60_000)
  assert.equal(ipLockDurationMs(100), 15 * 60_000)
})

test('registerFailure accepts a custom schedule (IP spray)', () => {
  let s: AttemptState = { failCount: 0, lastFailAt: null, lockedUntil: null }
  let now = t0
  for (let i = 0; i < 19; i++) {
    now += 1000
    s = registerFailure(s, now, ipLockDurationMs)
  }
  assert.equal(s.failCount, 19)
  assert.equal(s.lockedUntil, null)
  now += 1000
  s = registerFailure(s, now, ipLockDurationMs)
  assert.equal(s.failCount, 20)
  assert.equal(s.lockedUntil, now + 15 * 60_000)
})

test('a blocked state does not count the blocked attempt as a new failure', () => {
  // checkThrottle is a pure read; it must never mutate or escalate.
  let s = fresh
  let now = t0
  for (let i = 0; i < 5; i++) {
    now += 1000
    s = registerFailure(s, now)
  }
  const before = s.failCount
  checkThrottle(s, now + 5_000)
  checkThrottle(s, now + 5_000)
  assert.equal(s.failCount, before)
})
