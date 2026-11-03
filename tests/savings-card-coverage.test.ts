import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSlots, currentSlot, dayDeposits, slotKeyForDate } from '../src/lib/savings-card'

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

// Deposits are stamped when paid. `now` is Nov 5: a Bulk Savings deposit made today has ref BULK.
const bulk = { ref: 'BULK', createdAt: at(2026, 11, 5) }
const plain = { ref: 'PLAIN', createdAt: at(2026, 11, 5) }
const daysFor = (deposits: { ref: string; createdAt: string }[], coveredRefs: string[]) =>
  dayDeposits(deposits, coveredRefs).map(d => d.createdAt)

test('dayDeposits: drops only deposits with coverage rows', () => {
  assert.deepEqual(dayDeposits([bulk, plain], ['BULK']), [plain])
  assert.deepEqual(dayDeposits([bulk, plain], []), [bulk, plain])
  assert.deepEqual(dayDeposits([bulk, plain], undefined), [bulk, plain])
})

test('dayDeposits: a deposit with no ref is never treated as covered', () => {
  const noRef: { ref?: string; createdAt: string } = { createdAt: at(2026, 11, 5) }
  assert.deepEqual(dayDeposits([noRef], ['BULK']), [noRef])
})

test('daily: paying only for tomorrow leaves today unpaid and tomorrow saved', () => {
  const slots = buildSlots(daily, daysFor([bulk], ['BULK']), ['2026-11-06'], now)
  assert.equal(slots.find(x => x.key === '2026-11-05')?.state, 'today')
  assert.equal(slots.find(x => x.key === '2026-11-06')?.state, 'saved')
})

test('daily: paying for today and tomorrow saves both, by coverage', () => {
  const slots = buildSlots(daily, daysFor([bulk], ['BULK']), ['2026-11-05', '2026-11-06'], now)
  const today = slots.find(x => x.key === '2026-11-05')!
  assert.equal(today.state, 'saved')
  assert.equal(today.coveredOnly, true)
  assert.equal(slots.find(x => x.key === '2026-11-06')?.state, 'saved')
})

test('daily: a catch-up for past days does not mark the day it was paid', () => {
  const slots = buildSlots(daily, daysFor([bulk], ['BULK']), ['2026-11-02'], now)
  assert.equal(slots.find(x => x.key === '2026-11-02')?.state, 'saved')
  assert.equal(slots.find(x => x.key === '2026-11-05')?.state, 'today')
})

test('daily: a plain deposit still marks its day, beside a bulk one', () => {
  const slots = buildSlots(daily, daysFor([bulk, plain], ['BULK']), ['2026-11-06'], now)
  const today = slots.find(x => x.key === '2026-11-05')!
  assert.equal(today.state, 'saved')
  assert.equal(today.coveredOnly, false)
})

test('daily: a deposit with no coverage rows behaves as before, like a webhook mismatch', () => {
  const slots = buildSlots(daily, daysFor([bulk], []), [], now)
  assert.equal(slots.find(x => x.key === '2026-11-05')?.state, 'saved')
})

test('weekly: paying for next week only leaves this week unpaid', () => {
  const slots = buildSlots(weekly, daysFor([bulk], ['BULK']), ['2026-11-08'], now)
  assert.equal(slots.find(x => x.key === '2026-11-01')?.state, 'today')
  assert.equal(slots.find(x => x.key === '2026-11-08')?.state, 'saved')
})

test('currentSlot: finds the slot holding today, for days and weeks', () => {
  assert.equal(currentSlot(buildSlots(daily, [], [], now), '2026-11-05', false)?.key, '2026-11-05')
  assert.equal(currentSlot(buildSlots(weekly, [], [], now), '2026-11-05', true)?.key, '2026-11-01')
  assert.equal(currentSlot(buildSlots(daily, [], [], now), '2027-01-01', false), undefined)
})

test('slotKeyForDate: a daily plan maps a date to itself, only inside the plan', () => {
  const slots = buildSlots(daily, [], [], now)
  assert.equal(slotKeyForDate(slots, '2026-11-03', false), '2026-11-03')
  assert.equal(slotKeyForDate(slots, '2026-12-25', false), null)
})

test('slotKeyForDate: a weekly plan maps any day to the week holding it', () => {
  const slots = buildSlots(weekly, [], [], now)
  assert.equal(slotKeyForDate(slots, '2026-11-01', true), '2026-11-01')
  assert.equal(slotKeyForDate(slots, '2026-11-07', true), '2026-11-01')
  assert.equal(slotKeyForDate(slots, '2026-11-08', true), '2026-11-08')
  assert.equal(slotKeyForDate(slots, '2026-10-31', true), null)
  assert.equal(slotKeyForDate(slots, '2026-11-22', true), null)
})

// ── Online plans: paid only at the full plan amount ──
const online = { ...daily, source: 'self', dailyAmount: 100 }
const onlineWeekly = { ...weekly, source: 'self', dailyAmount: 100 }
const paid = (amount: number, day = 5) => ({ createdAt: at(2026, 11, day), amount })
const stateOf = (slots: ReturnType<typeof buildSlots>, key: string) => slots.find(s => s.key === key)?.state

test('online daily: the full amount is paid, one naira less is not', () => {
  assert.equal(stateOf(buildSlots(online, [paid(100)], [], now), '2026-11-05'), 'saved')
  assert.equal(stateOf(buildSlots(online, [paid(99)], [], now), '2026-11-05'), 'today')
  assert.equal(stateOf(buildSlots(online, [paid(99, 3)], [], now), '2026-11-03'), 'missed')
})

test('online daily: several deposits on the day add up', () => {
  assert.equal(stateOf(buildSlots(online, [paid(40), paid(60)], [], now), '2026-11-05'), 'saved')
})

test('online weekly: needs the full week across the slot', () => {
  assert.equal(stateOf(buildSlots(onlineWeekly, [paid(300, 2), paid(400, 6)], [], now), '2026-11-01'), 'saved')
  assert.equal(stateOf(buildSlots(onlineWeekly, [paid(300, 2), paid(399, 6)], [], now), '2026-11-01'), 'today')
})

test('online: coverage still pays a part-paid day', () => {
  const slot = buildSlots(online, [paid(50)], ['2026-11-05'], now).find(s => s.key === '2026-11-05')
  assert.equal(slot?.state, 'saved')
  assert.equal(slot?.coveredOnly, true)
})

test('offline: any deposit still counts, whatever the amount', () => {
  const offline = { ...online, source: 'agent' }
  assert.equal(stateOf(buildSlots(offline, [paid(1)], [], now), '2026-11-05'), 'saved')
  const offlineWeekly = { ...onlineWeekly, source: 'agent' }
  assert.equal(stateOf(buildSlots(offlineWeekly, [paid(1, 2)], [], now), '2026-11-01'), 'saved')
})
