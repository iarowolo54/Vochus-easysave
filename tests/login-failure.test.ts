// Unit test: what the agent login screen says after a failed sign-in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginFailure } from '../src/lib/login-failure'

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
    assert.match(loginFailure({ exists: true, status: 'Suspended', locked: true, lockedMinutesRemaining: 5 }, via).message, /locked.*5 min/i)
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
  const locked = { exists: true, status: 'Active', locked: true, lockedMinutesRemaining: 5 }
  assert.match(loginFailure(locked, 'password').message, /too many wrong passwords/i)
  const r = loginFailure(locked, 'fingerprint').message
  assert.match(r, /locked/i)
  assert.match(r, /5 min/)
  assert.doesNotMatch(r, /wrong password/i)
})
