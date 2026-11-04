// Unit test: reopening a finished plan (fake client, no database).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reopenPlan } from '../src/lib/plan-reopen'

const NOW = new Date('2026-11-04T10:00:00Z')

function fake(plan: { status: string; periodDays: number } | null, open = false) {
  const updates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = []
  const client = {
    savingsPlan: {
      findFirst: async () => (plan ? { id: 'p1', ...plan } : null),
      updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => { updates.push(a); return { count: 1 } },
    },
    earlyRedemption: { findFirst: async () => (open ? { id: 'r1' } : null) },
  }
  return { client: client as never, updates }
}

test('a redeemed plan goes back to Active as the same plan', async () => {
  const { client, updates } = fake({ status: 'Redeemed', periodDays: 30 })
  assert.deepEqual(await reopenPlan(client, { planId: 'p1', customerId: 'c1' }, NOW), { ok: true, planId: 'p1' })
  const d = updates[0].data
  assert.equal(d.status, 'Active')
  assert.equal('startDate' in d || 'feeCollected' in d, false)
  assert.equal((d.cycleStartedAt as Date).getTime(), NOW.getTime())
  assert.equal((d.maturityDate as Date).getTime() - NOW.getTime(), 30 * 86_400_000)
  assert.equal(updates[0].where.status, 'Redeemed')
})

test('a matured plan keeps its money, start date and interest', async () => {
  const { client, updates } = fake({ status: 'Active', periodDays: 60 })
  assert.equal((await reopenPlan(client, { planId: 'p1', customerId: 'c1' }, NOW)).ok, true)
  const d = updates[0].data
  assert.deepEqual(Object.keys(d).sort(), ['maturityDate', 'maturityNotified'])
  assert.deepEqual((updates[0].where.maturityDate as { lte: Date }).lte, NOW)
})

test('refuses while a collection is in progress, and for plans that are not the customer’s', async () => {
  const busy = fake({ status: 'Redeemed', periodDays: 30 }, true)
  assert.deepEqual(await reopenPlan(busy.client, { planId: 'p1', customerId: 'c1' }, NOW), { ok: false, reason: 'collecting' })
  assert.equal(busy.updates.length, 0)
  const none = fake(null)
  assert.deepEqual(await reopenPlan(none.client, { planId: 'p1', customerId: 'c1' }, NOW), { ok: false, reason: 'not_found' })
})
