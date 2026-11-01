// Characterization test: the proxy admin gate (src/proxy.ts) admits a session
// iff isAdminAreaRole(role). Per-area enforcement lives in the route guards.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAdminAreaRole } from '../src/lib/permissions'

test('proxy gate admits superadmin and staff', () => {
  assert.equal(isAdminAreaRole('superadmin'), true)
  assert.equal(isAdminAreaRole('staff'), true)
})

test('proxy gate rejects agent/customer/other roles (shared-secret hole stays closed)', () => {
  for (const r of ['agent', 'subagent', 'customer', '', null, undefined, 'STAFF']) {
    assert.equal(isAdminAreaRole(r), false, String(r))
  }
})
