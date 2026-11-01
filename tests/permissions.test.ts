// Pure authorization core for super-admin user management.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePermissions, hasArea, isAdminAreaRole, decideAdminAccess } from '../src/lib/permissions'

test('parsePermissions keeps only valid, unique area keys', () => {
  assert.deepEqual(parsePermissions('["agents","money"]'), ['agents', 'money'])
  assert.deepEqual(parsePermissions('["agents","agents","bogus",5]'), ['agents']) // unknown + non-string + dedupe
  assert.deepEqual(parsePermissions('not json'), [])
  assert.deepEqual(parsePermissions(null), [])
})

test('hasArea checks membership', () => {
  assert.equal(hasArea(['agents'], 'agents'), true)
  assert.equal(hasArea(['agents'], 'money'), false)
})

test('isAdminAreaRole accepts only superadmin and staff', () => {
  for (const r of ['superadmin', 'staff']) assert.equal(isAdminAreaRole(r), true)
  for (const r of ['agent', 'subagent', 'customer', '', null, undefined, 'STAFF']) assert.equal(isAdminAreaRole(r), false)
})

test('decideAdminAccess applies the role/status/area matrix', () => {
  assert.equal(decideAdminAccess({ role: null, area: 'agents' }), 'deny-401')
  assert.equal(decideAdminAccess({ role: 'superadmin', area: 'money' }), 'allow')
  assert.equal(decideAdminAccess({ role: 'staff', area: null, staffStatus: 'Active' }), 'allow') // baseline
  assert.equal(decideAdminAccess({ role: 'staff', area: 'agents', staffStatus: 'Active', roleStatus: 'Active', rolePerms: ['agents'] }), 'allow')
  assert.equal(decideAdminAccess({ role: 'staff', area: 'agents', staffStatus: 'Active', roleStatus: 'Active', rolePerms: ['customers'] }), 'deny-403') // area not granted
  assert.equal(decideAdminAccess({ role: 'staff', area: 'agents', staffStatus: 'Suspended', roleStatus: 'Active', rolePerms: ['agents'] }), 'deny-403') // suspended
  assert.equal(decideAdminAccess({ role: 'staff', area: 'agents', staffStatus: 'Active', roleStatus: 'Archived', rolePerms: ['agents'] }), 'deny-403') // archived role
  assert.equal(decideAdminAccess({ role: 'staff', area: 'agents', staffStatus: 'Active', roleStatus: 'Active', rolePerms: null }), 'deny-403') // no role assigned
  assert.equal(decideAdminAccess({ role: 'agent', area: 'agents' }), 'deny-403')
})
