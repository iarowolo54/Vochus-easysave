//   NEXTAUTH_SECRET=test npx tsx --test tests/admin-guard.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Session } from 'next-auth'
import { resolveAdminAccess, resolveAnyPermission, resolveDeptManage } from '../src/lib/admin-guard'
import type { Action, ScreenKey } from '../src/lib/permissions'

type Staff = {
  id: string
  name: string | null
  status: string
  departmentId: string | null
  roleRef: { status: string; permissions: string } | null
}

const sess = (role: string, id = 's1', name: string | null = 'Sam'): Session =>
  ({ user: { role, id, name }, expires: '2999-01-01' }) as unknown as Session

function deps(session: Session | null, staff: Staff | null = null, leadId: string | null = null) {
  const calls = { loadStaff: 0 }
  return {
    calls,
    d: {
      getSession: async () => session,
      loadStaff: async () => {
        calls.loadStaff++
        return staff
      },
      loadDepartmentLead: async () => leadId,
    },
  }
}
const staffRec = (perms: string, o: Partial<Staff> = {}, roleStatus = 'Active'): Staff => ({
  id: 's1', name: 'Sam Staff', status: 'Active', departmentId: 'd1', roleRef: { status: roleStatus, permissions: perms }, ...o,
})

async function expectDeny(r: { ok: boolean; response?: Response }, status: number, error: string) {
  assert.equal(r.ok, false)
  if (r.ok || !r.response) return
  assert.equal(r.response.status, status)
  assert.deepEqual(await r.response.json(), { error })
}

test('superadmin allowed without DB read', async () => {
  const { d, calls } = deps(sess('superadmin', 'a1', 'Boss'))
  const r = await resolveAdminAccess('treasury', 'manage', d)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.actor, { id: 'a1', name: 'Boss', type: 'superadmin' })
  assert.equal(calls.loadStaff, 0)
})

test('staff with screen:manage is allowed to manage and to view; actor from loaded staff', async () => {
  const { d } = deps(sess('staff'), staffRec('["redemptions:manage"]'))
  const m = await resolveAdminAccess('redemptions', 'manage', d)
  assert.equal(m.ok, true)
  if (m.ok) assert.deepEqual(m.actor, { id: 's1', name: 'Sam Staff', type: 'staff' })
  assert.equal((await resolveAdminAccess('redemptions', 'view', d)).ok, true)
})

test('staff with only :view cannot manage', async () => {
  const { d } = deps(sess('staff'), staffRec('["redemptions:view"]'))
  await expectDeny(await resolveAdminAccess('redemptions', 'manage', d), 403, 'Forbidden')
  assert.equal((await resolveAdminAccess('redemptions', 'view', d)).ok, true)
})

test('suspended, invited, archived-role and role-less staff -> 403', async () => {
  const p = '["redemptions:manage"]'
  await expectDeny(await resolveAdminAccess('redemptions', 'view', deps(sess('staff'), staffRec(p, { status: 'Suspended' })).d), 403, 'Forbidden')
  await expectDeny(await resolveAdminAccess('redemptions', 'view', deps(sess('staff'), staffRec(p, { status: 'Invited' })).d), 403, 'Forbidden')
  await expectDeny(await resolveAdminAccess('redemptions', 'view', deps(sess('staff'), staffRec(p, {}, 'Archived')).d), 403, 'Forbidden')
  await expectDeny(await resolveAdminAccess('redemptions', 'view', deps(sess('staff'), staffRec(p, { roleRef: null })).d), 403, 'Forbidden')
})

test('deleted staff and agent/customer tokens -> 403, no session -> 401', async () => {
  await expectDeny(await resolveAdminAccess('agents', 'view', deps(sess('staff'), null).d), 403, 'Forbidden')
  await expectDeny(await resolveAdminAccess('agents', 'view', deps(sess('agent')).d), 403, 'Forbidden')
  await expectDeny(await resolveAdminAccess('agents', 'view', deps(null).d), 401, 'Unauthorized')
})

test('baseline admin area (null screen): active staff allowed, suspended denied', async () => {
  assert.equal((await resolveAdminAccess(null, 'view', deps(sess('staff'), staffRec('[]', { roleRef: null })).d)).ok, true)
  await expectDeny(await resolveAdminAccess(null, 'view', deps(sess('staff'), staffRec('[]', { status: 'Suspended' })).d), 403, 'Forbidden')
})

test('requireDeptManage: superadmin allowed without DB read', async () => {
  const { d, calls } = deps(sess('superadmin', 'a1'))
  assert.equal((await resolveDeptManage('d1', d)).ok, true)
  assert.equal(calls.loadStaff, 0)
})

test('requireDeptManage: active lead of that department allowed', async () => {
  const { d } = deps(sess('staff'), staffRec('[]'), 's1')
  assert.equal((await resolveDeptManage('d1', d)).ok, true)
})

test('requireDeptManage: a suspended lead, a moved lead, a non-lead and another department are all 403', async () => {
  await expectDeny(await resolveDeptManage('d1', deps(sess('staff'), staffRec('[]', { status: 'Suspended' }), 's1').d), 403, 'Forbidden')
  await expectDeny(await resolveDeptManage('d1', deps(sess('staff'), staffRec('[]', { departmentId: 'd2' }), 's1').d), 403, 'Forbidden')
  await expectDeny(await resolveDeptManage('d1', deps(sess('staff'), staffRec('[]'), 'someone-else').d), 403, 'Forbidden')
  await expectDeny(await resolveDeptManage('d1', deps(sess('staff'), staffRec('[]'), null).d), 403, 'Forbidden')
  await expectDeny(await resolveDeptManage('d2', deps(sess('staff'), staffRec('[]'), 's1').d), 403, 'Forbidden')
})

test('requireDeptManage: agent token 403, no session 401', async () => {
  await expectDeny(await resolveDeptManage('d1', deps(sess('agent')).d), 403, 'Forbidden')
  await expectDeny(await resolveDeptManage('d1', deps(null).d), 401, 'Unauthorized')
})

test('resolveAnyPermission: allowed if any option is granted, otherwise the first denial', async () => {
  const opts: [ScreenKey, Action][] = [['agents', 'manage'], ['devices', 'manage']]
  assert.equal((await resolveAnyPermission(opts, deps(sess('staff'), staffRec('["devices:manage"]')).d)).ok, true)
  assert.equal((await resolveAnyPermission(opts, deps(sess('staff'), staffRec('["agents:manage"]')).d)).ok, true)
  await expectDeny(await resolveAnyPermission(opts, deps(sess('staff'), staffRec('["devices:view","agents:view"]')).d), 403, 'Forbidden')
  await expectDeny(await resolveAnyPermission(opts, deps(null).d), 401, 'Unauthorized')
})
