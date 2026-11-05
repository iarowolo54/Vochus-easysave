// Unit test: what the agent login screen says after a failed sign-in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authReachability, loginFailure, reachabilityMessage } from '../src/lib/login-failure'

test('a suspended agent is told so, by password or fingerprint', () => {
  for (const via of ['password', 'fingerprint'] as const) {
    assert.match(loginFailure({ exists: true, status: 'Suspended' }, via).message, /suspended/i)
  }
})

test('a pending agent is told to wait, by password or fingerprint', () => {
  for (const via of ['password', 'fingerprint'] as const) {
    assert.match(loginFailure({ exists: true, status: 'PendingActivation' }, via).message, /waiting to be activated/i)
  }
})

test('account problems outrank status, in the same order for both', () => {
  for (const via of ['password', 'fingerprint'] as const) {
    assert.match(loginFailure({ exists: true, status: 'Suspended', locked: true }, via).message, /locked/i)
    assert.match(loginFailure({ exists: true, status: 'Active', deviceMismatch: true }, via).message, /another phone/i)
    assert.match(loginFailure({ exists: true, status: 'Active', unverifiedEmail: true }, via).message, /verified/i)
  }
})

test('password: an Active agent gets wrong password, on the password field', () => {
  const r = loginFailure({ exists: true, status: 'Active' }, 'password')
  assert.match(r.message, /wrong password/i)
  assert.equal(r.field, 'password')
})

test('fingerprint: an Active agent is sent to their password, never told it was wrong', () => {
  const r = loginFailure({ exists: true, status: 'Active' }, 'fingerprint')
  assert.match(r.message, /sign in with your password/i)
  assert.doesNotMatch(r.message, /wrong password/i)
  assert.equal(r.field, undefined)
})

test('unknown account: password points at the identifier field, fingerprint stays generic', () => {
  assert.equal(loginFailure({ exists: false }, 'password').field, 'identifier')
  assert.match(loginFailure({ exists: false }, 'fingerprint').message, /sign in with your password/i)
})

test('a locked account: fingerprint wording does not blame wrong passwords', () => {
  const locked = { exists: true, status: 'Active', locked: true }
  assert.match(loginFailure(locked, 'password').message, /too many wrong passwords/i)
  assert.doesNotMatch(loginFailure(locked, 'password').message, /\d+ min/)
  const r = loginFailure(locked, 'fingerprint').message
  assert.match(r, /locked/i)
  assert.match(r, /Forgot password/)
  assert.doesNotMatch(r, /min/)
  assert.doesNotMatch(r, /wrong password/i)
})

test('too many attempts from this network is said plainly, by password or fingerprint', () => {
  for (const via of ['password', 'fingerprint'] as const) {
    const r = loginFailure({ exists: true, status: 'Active', throttledSeconds: 600 }, via)
    assert.match(r.message, /too many/i)
    assert.match(r.message, /10 min/)
    assert.equal(r.field, undefined)
  }
})

test('authReachability: tells no connection apart from a server fault', async () => {
  assert.equal(await authReachability(async () => new Response('{}', { status: 200 })), 'ok')
  assert.equal(await authReachability(async () => new Response('', { status: 500 })), 'server')
  assert.equal(await authReachability(async () => new Response('', { status: 503 })), 'server')
  assert.equal(await authReachability(async () => { throw new TypeError('Failed to fetch') }), 'offline')
})

test('a server fault is not reported as no internet', () => {
  assert.match(reachabilityMessage('offline'), /internet/i)
  assert.doesNotMatch(reachabilityMessage('server'), /internet/i)
  assert.match(reachabilityMessage('server'), /our side/i)
})
