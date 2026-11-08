import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ajoDueEvents, type DueGroup } from '../src/lib/ajo-notices'
import { lagosMidnight } from '../src/lib/ajo'

const g = (over: Partial<DueGroup> = {}): DueGroup => ({
  id: 'g1', name: 'Market', agentId: 'a1', cadence: 'weekly', size: 3, contribution: 1000, startDate: lagosMidnight('2026-11-10'),
  paidOutRounds: [], members: [{ id: 'm1', customerId: 'c1' }, { id: 'm2', customerId: 'c2' }, { id: 'm3', customerId: 'c3' }],
  paid: [{ memberId: 'm1', round: 1 }], ...over,
})
const at = (day: string) => new Date(`${day}T08:00:00+01:00`)

test('nothing before the due day', () => {
  assert.deepEqual(ajoDueEvents([g()], at('2026-11-09')), [])
})

test('on the due day: unpaid members only, no agent notice yet', () => {
  const keys = ajoDueEvents([g()], at('2026-11-10')).map(e => e.dedupeKey)
  assert.deepEqual(keys, ['ajo-due:m2:1:w0', 'ajo-due:m3:1:w0'])
})

test('the day after: agent hears how many are holding it up; weekly after that', () => {
  const day1 = ajoDueEvents([g()], at('2026-11-11'))
  const late = day1.find(e => e.kind === 'ajo_late')!
  assert.equal(late.dedupeKey, 'ajo-late:g1:1:w0')
  assert.equal(late.title, 'Market: 2 members haven’t paid')
  assert.ok(ajoDueEvents([g()], at('2026-11-17')).some(e => e.dedupeKey === 'ajo-due:m2:1:w1'))
  assert.ok(ajoDueEvents([g()], at('2026-11-18')).some(e => e.dedupeKey === 'ajo-late:g1:1:w1'))
})

test('the open round moves on after a payout; finished groups are quiet', () => {
  const keys = ajoDueEvents([g({ paidOutRounds: [1], paid: [] })], at('2026-11-17')).map(e => e.dedupeKey)
  assert.ok(keys.includes('ajo-due:m1:2:w0'))
  assert.deepEqual(ajoDueEvents([g({ paidOutRounds: [1, 2, 3] })], at('2026-12-30')), [])
})
