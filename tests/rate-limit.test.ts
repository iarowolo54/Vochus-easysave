// Unit tests for the in-memory sliding-window rate limiter used by the
// unauthenticated enrolment endpoints (phone-available, email-otp, invite).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRateLimiter } from '../src/lib/rate-limit'

test('allows up to the limit within the window, then blocks', () => {
  const rl = createRateLimiter()
  const t0 = 1_000_000
  for (let i = 0; i < 3; i++) {
    assert.equal(rl.check('ip:1', 3, 60_000, t0 + i).allowed, true)
  }
  const blocked = rl.check('ip:1', 3, 60_000, t0 + 3)
  assert.equal(blocked.allowed, false)
  assert.ok(blocked.retryAfterMs > 0)
})

test('separate keys have independent budgets', () => {
  const rl = createRateLimiter()
  const t0 = 2_000_000
  assert.equal(rl.check('ip:a', 1, 60_000, t0).allowed, true)
  assert.equal(rl.check('ip:a', 1, 60_000, t0 + 1).allowed, false)
  assert.equal(rl.check('ip:b', 1, 60_000, t0 + 1).allowed, true)
})

test('the window slides: old hits expire', () => {
  const rl = createRateLimiter()
  const t0 = 3_000_000
  assert.equal(rl.check('ip:2', 1, 1_000, t0).allowed, true)
  assert.equal(rl.check('ip:2', 1, 1_000, t0 + 500).allowed, false)
  // after the window passes, the old hit no longer counts
  assert.equal(rl.check('ip:2', 1, 1_000, t0 + 1_001).allowed, true)
})

test('retryAfterMs reflects when the oldest hit leaves the window', () => {
  const rl = createRateLimiter()
  const t0 = 4_000_000
  rl.check('ip:3', 1, 10_000, t0)
  const blocked = rl.check('ip:3', 1, 10_000, t0 + 3_000)
  assert.equal(blocked.allowed, false)
  // oldest hit at t0 leaves the window at t0+10000, i.e. 7000ms from now
  assert.equal(blocked.retryAfterMs, 7_000)
})
