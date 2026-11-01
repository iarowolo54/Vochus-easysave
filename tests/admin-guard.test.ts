//   NEXTAUTH_SECRET=test npx tsx --test tests/admin-guard.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Session } from 'next-auth'
import { resolveAdminAccess } from '../src/lib/admin-guard'

type Staff = { id: string; name: string | null; status: string; roleRef: { status: string; permissions: string } | null }

const sess = (role: string, id = 's1', name: string | null = 'Sam'): Session =>
  ({ user: { role, id, name }, expires: '2999-01-01' }) as unknown as Session

function deps(session: Session | null, staff: Staff | null = null) {
  const calls = { loadStaff: 0 }
  return {
    calls,
    d: {
      getSession: async () => session,
      loadStaff: async () => {
        calls.loadStaff++
        return staff
      },
    },
  }
}
const activeStaff = (perms: string, roleStatus = 'Active', status = 'Active'): Staff => ({
  id: 's1', name: 'Sam Staff', status, roleRef: { status: roleStatus, permissions: perms },
})

async function expectDeny(r: Awaited<ReturnType<typeof resolveAdminAccess>>, status: number, error: string) {
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.response.status, status)
  assert.deepEqual(await r.response.json(), { error })
}

test('superadmin allowed without DB read', async () => {
  const { d, calls } = deps(sess('superadmin', 'a1', 'Boss'))
  const r = await resolveAdminAccess('money', d)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.actor, { id: 'a1', name: 'Boss', type: 'superadmin' })
  assert.equal(calls.loadStaff, 0)
})

test('active staff with area allowed; actor from loaded staff', async () => {
  const { d } = deps(sess('staff'), activeStaff('["money","loans"]'))
  const r = await resolveAdminAccess('money', d)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.actor, { id: 's1', name: 'Sam Staff', type: 'staff' })
})

test('suspended staff -> 403', async () => {
  const { d } = deps(sess('staff'), activeStaff('["money"]', 'Active', 'Suspended'))
  await expectDeny(await resolveAdminAccess('money', d), 403, 'Forbidden')
})

test('archived role -> 403', async () => {
  const { d } = deps(sess('staff'), activeStaff('["money"]', 'Archived'))
  await expectDeny(await resolveAdminAccess('money', d), 403, 'Forbidden')
})

test('staff with no role -> 403', async () => {
  const { d } = deps(sess('staff'), { id: 's1', name: 'x', status: 'Active', roleRef: null })
  await expectDeny(await resolveAdminAccess('money', d), 403, 'Forbidden')
})

test('role lacks area -> 403', async () => {
  const { d } = deps(sess('staff'), activeStaff('["loans"]'))
  await expectDeny(await resolveAdminAccess('money', d), 403, 'Forbidden')
})

test('staff row missing -> 403', async () => {
  const { d } = deps(sess('staff'), null)
  await expectDeny(await resolveAdminAccess('money', d), 403, 'Forbidden')
})

test('agent role -> 403', async () => {
  const { d, calls } = deps(sess('agent'))
  await expectDeny(await resolveAdminAccess('money', d), 403, 'Forbidden')
  assert.equal(calls.loadStaff, 0)
})

test('no session -> 401', async () => {
  const { d } = deps(null)
  await expectDeny(await resolveAdminAccess('money', d), 401, 'Unauthorized')
})

test('area null: active staff with no matching area allowed', async () => {
  const { d } = deps(sess('staff'), activeStaff('[]'))
  assert.equal((await resolveAdminAccess(null, d)).ok, true)
})

test('area null: suspended staff -> 403', async () => {
  const { d } = deps(sess('staff'), activeStaff('[]', 'Active', 'Suspended'))
  await expectDeny(await resolveAdminAccess(null, d), 403, 'Forbidden')
})

test('area null: no session -> 401', async () => {
  const { d } = deps(null)
  await expectDeny(await resolveAdminAccess(null, d), 401, 'Unauthorized')
})
