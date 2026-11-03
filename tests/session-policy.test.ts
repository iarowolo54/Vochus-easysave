// Pure policy tests for session expiry (idle + absolute cap). No DB, no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IDLE_SECONDS,
  ABSOLUTE_SECONDS,
  evaluateSession,
  isPastAbsoluteCap,
  actorForPage,
  type Actor,
} from '../src/lib/session-policy'

test('policy constants match the design spec', () => {
  assert.deepEqual(IDLE_SECONDS, { admin: 900, agent: 3600, customer: 3600 })
  assert.deepEqual(ABSOLUTE_SECONDS, { admin: 28800, agent: 604800, customer: 604800 })
})

for (const actor of ['admin', 'agent', 'customer'] as Actor[]) {
  test(`evaluateSession(${actor}): within cap slides by the idle window`, () => {
    const loginAt = 1_000_000
    const now = loginAt + 100
    assert.deepEqual(evaluateSession(actor, loginAt, now), { action: 'slide', newExp: now + IDLE_SECONDS[actor] })
  })
  test(`evaluateSession(${actor}): exactly at the cap still slides`, () => {
    const loginAt = 1_000_000
    const now = loginAt + ABSOLUTE_SECONDS[actor]
    assert.deepEqual(evaluateSession(actor, loginAt, now), { action: 'slide', newExp: now + IDLE_SECONDS[actor] })
  })
  test(`evaluateSession(${actor}): one second past the cap expires`, () => {
    const loginAt = 1_000_000
    assert.deepEqual(evaluateSession(actor, loginAt, loginAt + ABSOLUTE_SECONDS[actor] + 1), { action: 'expire' })
  })
  test(`isPastAbsoluteCap(${actor}): false at the cap, true one second past`, () => {
    const loginAt = 1_000_000
    assert.equal(isPastAbsoluteCap(actor, loginAt, loginAt + ABSOLUTE_SECONDS[actor]), false)
    assert.equal(isPastAbsoluteCap(actor, loginAt, loginAt + ABSOLUTE_SECONDS[actor] + 1), true)
  })
}

test('actorForPage: the admin accept-invite page is public', () => {
  assert.equal(actorForPage('/superadmin/accept-invite'), null)
})

test('actorForPage: guarded pages', () => {
  assert.deepEqual(actorForPage('/dashboard/x'), { actor: 'agent', loginUrl: '/login' })
  assert.deepEqual(actorForPage('/dashboard'), { actor: 'agent', loginUrl: '/login' })
  assert.deepEqual(actorForPage('/superadmin/x'), { actor: 'admin', loginUrl: '/superadmin/login' })
  assert.deepEqual(actorForPage('/customer/dashboard'), { actor: 'customer', loginUrl: '/customer/login' })
})

test('actorForPage: public pages are null', () => {
  for (const p of ['/', '/login', '/superadmin/login', '/customer/login', '/customer/enroll', '/customer/forgot-password', '/customer/unlock', '/customer/login/x', '/about', '/dashboardx']) {
    assert.equal(actorForPage(p), null, p)
  }
})

test('actorForPage: matches segments, not prefixes', () => {
  assert.deepEqual(actorForPage('/customer/loginfoo'), { actor: 'customer', loginUrl: '/customer/login' })
})
