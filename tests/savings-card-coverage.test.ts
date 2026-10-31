import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSlots } from '../src/lib/savings-card'

// Local noon, serialised to ISO, so the local-time day key is stable in any timezone.
const at = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12).toISOString()

const daily = {
  startDate: at(2026, 11, 1),
  maturityDate: at(2026, 11, 10),
  periodDays: 10,
  cadence: 'daily',
}

const weekly = {
  startDate: at(2026, 11, 1),
  maturityDate: at(2027, 1, 10),
  periodDays: 21,
  cadence: 'weekly',
}

// "now" is Nov 5, so Nov 1-4 are past, Nov 5 is today, Nov 6+ upcoming.
const now = new Date(2026, 10, 5, 12)

test('daily: covered key with no deposit -> saved and coveredOnly', () => {
  const slots = buildSlots(daily, [], ['2026-11-02'], now)
  const s = slots.find(x => x.key === '2026-11-02')!
  assert.equal(s.state, 'saved')
  assert.equal(s.coveredOnly, true)
})

test('daily: real deposit -> saved and not coveredOnly', () => {
  const slots = buildSlots(daily, [at(2026, 11, 3)], [], now)
  const s = slots.find(x => x.key === '2026-11-03')!
  assert.equal(s.state, 'saved')
  assert.equal(s.coveredOnly, false)
})

test('daily: deposit and covered on same key -> saved and not coveredOnly', () => {
  const slots = buildSlots(daily, [at(2026, 11, 3)], ['2026-11-03'], now)
  const s = slots.find(x => x.key === '2026-11-03')!
  assert.equal(s.state, 'saved')
  assert.equal(s.coveredOnly, false)
})

test('daily: past slot in neither list -> missed and not coveredOnly', () => {
  const slots = buildSlots(daily, [], [], now)
  const s = slots.find(x => x.key === '2026-11-01')!
  assert.equal(s.state, 'missed')
  assert.equal(s.coveredOnly, false)
})

test('daily: omitted coveredKeys keeps existing behaviour', () => {
  const slots = buildSlots(daily, [at(2026, 11, 1)], [], now)
  assert.equal(slots.find(x => x.key === '2026-11-01')!.state, 'saved')
  assert.equal(slots.find(x => x.key === '2026-11-02')!.state, 'missed')
  assert.equal(slots.find(x => x.key === '2026-11-01')!.coveredOnly, false)
})

test('weekly: covered key inside a week -> that week saved and coveredOnly', () => {
  // Week 2 spans Nov 8-14; cover Nov 10 with no deposit.
  const slots = buildSlots(weekly, [], ['2026-11-10'], now)
  const w2 = slots.find(x => x.index === 2)!
  assert.equal(w2.state, 'saved')
  assert.equal(w2.coveredOnly, true)
  // Week 1 (Nov 1-7) contains today (Nov 5), so it is 'today' rather than 'missed'.
  assert.equal(slots.find(x => x.index === 1)!.state, 'today')
})

test('weekly: real deposit in a week -> saved and not coveredOnly', () => {
  const slots = buildSlots(weekly, [at(2026, 11, 9)], [], now)
  const w2 = slots.find(x => x.index === 2)!
  assert.equal(w2.state, 'saved')
  assert.equal(w2.coveredOnly, false)
})
