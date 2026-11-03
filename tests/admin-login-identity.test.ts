import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickIdentity } from '../src/lib/admin-identity'

const sa = { id: 'sa1', name: 'Root', email: 'a@x.com' }
const st = { id: 'st1', name: 'Staff', email: 'a@x.com', status: 'Active', password: 'hash' }

test('both present -> superadmin wins', () => {
  assert.deepEqual(pickIdentity({ superAdmin: sa, staff: st }), { kind: 'superadmin', ...sa })
})
test('only active staff -> staff', () => {
  assert.deepEqual(pickIdentity({ superAdmin: null, staff: st }), {
    kind: 'staff', id: 'st1', name: 'Staff', email: 'a@x.com',
  })
})
test('only suspended staff -> none', () => {
  assert.deepEqual(pickIdentity({ superAdmin: null, staff: { ...st, status: 'Suspended' } }), { kind: 'none' })
})
test('neither -> none', () => {
  assert.deepEqual(pickIdentity({ superAdmin: null, staff: null }), { kind: 'none' })
})
test('only superadmin -> superadmin', () => {
  assert.deepEqual(pickIdentity({ superAdmin: sa, staff: null }), { kind: 'superadmin', ...sa })
})
test('invited staff (no password yet) -> none', () => {
  assert.deepEqual(pickIdentity({ superAdmin: null, staff: { ...st, status: 'Invited', password: null } }), { kind: 'none' })
})
test('active staff with a null password -> none', () => {
  assert.deepEqual(pickIdentity({ superAdmin: null, staff: { ...st, password: null } }), { kind: 'none' })
})
test('invited staff with a leftover password -> none', () => {
  assert.deepEqual(pickIdentity({ superAdmin: null, staff: { ...st, status: 'Invited' } }), { kind: 'none' })
})
