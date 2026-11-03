// Pure authorization core for super-admin user management (per-screen view/manage).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SCREENS,
  MONEY_SCREENS,
  parsePermissions,
  hasPermission,
  validateRolePermissions,
  canGrant,
  canEditRole,
  isAdminAreaRole,
  decideAdminAccess,
  type Perm,
} from '../src/lib/permissions'

test('parsePermissions normalizes manage to carry view and drops invalid tokens', () => {
  assert.deepEqual(parsePermissions('["redemptions:manage"]').sort(), ['redemptions:manage', 'redemptions:view'])
  assert.deepEqual(parsePermissions('["x:bogus","audit:manage",5]'), []) // unknown screen/action, view-only screen, non-string
  assert.deepEqual(parsePermissions('["customers:view","customers:view"]'), ['customers:view'])
  assert.deepEqual(parsePermissions('nope'), [])
  assert.deepEqual(parsePermissions(null), [])
  assert.deepEqual(parsePermissions('{"a":1}'), [])
})

test('view-only screens never offer manage', () => {
  for (const key of ['agent-wallets', 'transactions', 'audit', 'reports']) {
    const s = SCREENS.find((x) => x.key === key)
    assert.ok(s, key)
    assert.deepEqual(s.actions, ['view'])
  }
})

test('MONEY_SCREENS are all in the catalog', () => {
  const keys = SCREENS.map((s) => s.key)
  assert.ok(MONEY_SCREENS.length > 0)
  for (const k of MONEY_SCREENS) assert.ok(keys.includes(k), k)
})

test('hasPermission: manage implies view, view does not imply manage', () => {
  assert.equal(hasPermission(['redemptions:manage'], 'redemptions', 'view'), true)
  assert.equal(hasPermission(['redemptions:view'], 'redemptions', 'manage'), false)
  assert.equal(hasPermission(['redemptions:view'], 'redemptions', 'view'), true)
  assert.equal(hasPermission(['loans:manage'], 'redemptions', 'view'), false)
})

test('validateRolePermissions normalizes and names unknown tokens', () => {
  assert.deepEqual(validateRolePermissions(['customers:view']), { ok: true, perms: ['customers:view'] })
  const r = validateRolePermissions(['treasury:manage', 'treasury:manage'])
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual([...r.perms].sort(), ['treasury:manage', 'treasury:view'])
  const bad = validateRolePermissions(['nope:view', 'audit:manage', 7])
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.deepEqual(bad.unknown, ['nope:view', 'audit:manage', '7'])
  assert.equal(validateRolePermissions('x').ok, false)
})

test('canGrant is a subset check against the normalized ceiling', () => {
  assert.equal(canGrant(['customers:manage'], ['customers:view']), true)
  assert.equal(canGrant(['customers:view'], ['customers:manage']), false)
  assert.equal(canGrant(['customers:manage'], ['treasury:view']), false)
  assert.equal(canGrant([], []), true)
})

test('canEditRole needs both the current and the resulting set within the ceiling', () => {
  const lead: Perm[] = ['customers:manage', 'loans:view']
  assert.equal(canEditRole(lead, ['customers:view'], ['customers:manage']), true)
  assert.equal(canEditRole(lead, ['customers:view'], ['treasury:view']), false) // result exceeds
  assert.equal(canEditRole(lead, ['treasury:manage'], ['customers:view']), false) // current exceeds (cannot launder)
  assert.equal(canEditRole(lead, [], []), true)
})

test('isAdminAreaRole', () => {
  assert.equal(isAdminAreaRole('superadmin'), true)
  assert.equal(isAdminAreaRole('staff'), true)
  assert.equal(isAdminAreaRole('agent'), false)
  assert.equal(isAdminAreaRole(undefined), false)
})

test('decideAdminAccess', () => {
  assert.equal(decideAdminAccess({ role: 'superadmin', screen: 'treasury', action: 'manage' }), 'allow')
  assert.equal(decideAdminAccess({ role: undefined, screen: 'treasury' }), 'deny-401')
  const staff = { role: 'staff', staffStatus: 'Active', roleStatus: 'Active' }
  assert.equal(decideAdminAccess({ ...staff, screen: 'redemptions', action: 'manage', rolePerms: ['redemptions:view'] }), 'deny-403')
  assert.equal(decideAdminAccess({ ...staff, screen: 'redemptions', action: 'view', rolePerms: ['redemptions:manage'] }), 'allow')
  assert.equal(decideAdminAccess({ ...staff, screen: 'redemptions', rolePerms: ['redemptions:view'] }), 'allow') // action defaults to view
  assert.equal(decideAdminAccess({ role: 'staff', screen: null, staffStatus: 'Active' }), 'allow')
  assert.equal(decideAdminAccess({ role: 'staff', screen: 'agents', action: 'view', staffStatus: 'Suspended', roleStatus: 'Active', rolePerms: ['agents:view'] }), 'deny-403')
  assert.equal(decideAdminAccess({ role: 'staff', screen: 'agents', action: 'view', staffStatus: 'Invited', roleStatus: 'Active', rolePerms: ['agents:view'] }), 'deny-403')
  assert.equal(decideAdminAccess({ ...staff, roleStatus: 'Archived', screen: 'agents', action: 'view', rolePerms: ['agents:view'] }), 'deny-403')
  assert.equal(decideAdminAccess({ role: 'agent', screen: 'agents', action: 'view' }), 'deny-403')
})
