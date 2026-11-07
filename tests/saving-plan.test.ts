// Unit tests for plan start-date parsing (#6).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePlanStartDate } from '../src/lib/saving-plan'

const today = new Date('2026-10-28T09:00:00')

test('no start date defaults to now', () => {
  const r = resolvePlanStartDate(undefined, today)
  assert.ok('date' in r && r.date instanceof Date)
})

test('empty string defaults to now', () => {
  assert.ok('date' in resolvePlanStartDate('', today))
})

test('today is accepted', () => {
  const r = resolvePlanStartDate('2026-10-28', today)
  assert.ok('date' in r)
})

test('a future date is accepted', () => {
  const r = resolvePlanStartDate('2026-12-01', today)
  assert.ok('date' in r)
  assert.equal((r as { date: Date }).date.getFullYear(), 2026)
})

test('a past date is rejected', () => {
  const r = resolvePlanStartDate('2026-10-27', today)
  assert.ok('error' in r)
})

test('a malformed date is rejected', () => {
  for (const bad of ['28-10-2026', '2026/10/28', 'tomorrow', '2026-13-40']) {
    assert.ok('error' in resolvePlanStartDate(bad, today), `"${bad}" should error`)
  }
})

// selectActivePlan with no planId: only plans still open for saving count, so an ended plan neither gets picked
// nor makes the choice ambiguous.
import { selectActivePlan } from '../src/lib/saving-plan'

function stub(rows: { id: string; source: string }[]) {
  const seen: unknown[] = []
  return {
    seen,
    client: {
      savingsPlan: {
        findMany: async (a: { where: unknown }) => { seen.push(a.where); return rows },
        findFirst: async (a: { where: unknown }) => { seen.push(a.where); return rows[0] ?? null },
      },
    } as unknown as Parameters<typeof selectActivePlan>[0],
  }
}

test('without a planId, plans past their end date are left out of the choice', async () => {
  const s = stub([{ id: 'open', source: 'agent' }])
  const r = await selectActivePlan(s.client, 'c1')
  assert.deepEqual(r, { plan: { id: 'open', source: 'agent' } })
  const where = s.seen[0] as { status: string; maturityDate?: { gt: Date } }
  assert.equal(where.status, 'Active')
  assert.ok(where.maturityDate?.gt instanceof Date, 'filters on the end date')
})

test('with a planId, an ended plan is still found so the route can say it has ended', async () => {
  const s = stub([{ id: 'p1', source: 'agent' }])
  await selectActivePlan(s.client, 'c1', 'p1')
  const where = s.seen[0] as { maturityDate?: unknown }
  assert.equal(where.maturityDate, undefined)
})
