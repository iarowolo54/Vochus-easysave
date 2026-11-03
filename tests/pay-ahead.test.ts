// Unit test: pay-ahead skip rule and next-payment walk (src/lib/pay-ahead.ts). Run under both
// TZ=UTC and TZ=Africa/Lagos: every expectation here is in WAT regardless of the process timezone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PENDING_HOLD_MS, inFlightKeys, isCycleCovered, isCycleInPlan, isSlotFunded, nextPaymentDate, ordinaryDeposits } from '../src/lib/pay-ahead'
import { buildSlotsWat, watKey } from '../src/lib/savings-card'
import { nextRunAt } from '../src/lib/auto-debit-schedule'

const at = (iso: string) => new Date(iso)

// Starts 00:30 WAT on Nov 2, which is still Nov 1 in UTC.
const dailyPlan = { cadence: 'daily', dailyAmount: 100, status: 'Active', periodDays: 10, startDate: at('2026-11-01T23:30:00Z'), maturityDate: at('2026-11-11T23:30:00Z') }
const weeklyPlan = { cadence: 'weekly', dailyAmount: 100, status: 'Active', periodDays: 42, startDate: at('2026-11-01T23:30:00Z'), maturityDate: at('2026-12-13T23:30:00Z') }

test('watKey: the WAT day flips at 23:00 UTC', () => {
  assert.equal(watKey(at('2026-11-02T22:59:59Z')), '2026-11-02')
  assert.equal(watKey(at('2026-11-02T23:00:00Z')), '2026-11-03')
  assert.equal(watKey(at('2026-11-02T23:30:00Z')), '2026-11-03')
})

test('buildSlotsWat: a plan started 00:30 WAT begins on the WAT day', () => {
  const slots = buildSlotsWat(
    { startDate: dailyPlan.startDate.toISOString(), maturityDate: dailyPlan.maturityDate.toISOString(), periodDays: 10, cadence: 'daily' },
    [], [], at('2026-11-03T12:00:00Z'),
  )
  assert.equal(slots[0].key, '2026-11-02')
  assert.equal(slots[0].state, 'missed')
  assert.equal(slots[1].key, '2026-11-03')
  assert.equal(slots[1].state, 'today')
  assert.equal(slots[2].state, 'upcoming')
  assert.equal(slots.length, 10)
})

test('buildSlotsWat: at 23:30 UTC "today" is already the next WAT day', () => {
  const slots = buildSlotsWat(
    { startDate: dailyPlan.startDate.toISOString(), maturityDate: dailyPlan.maturityDate.toISOString(), periodDays: 10, cadence: 'daily' },
    [], [], at('2026-11-03T23:30:00Z'),
  )
  assert.equal(slots.find(s => s.state === 'today')?.key, '2026-11-04')
})

test('buildSlotsWat: a deposit at 23:30 UTC counts for the next WAT day', () => {
  const slots = buildSlotsWat(
    { startDate: dailyPlan.startDate.toISOString(), maturityDate: dailyPlan.maturityDate.toISOString(), periodDays: 10, cadence: 'daily' },
    ['2026-11-03T23:30:00Z'], [], at('2026-11-05T12:00:00Z'),
  )
  assert.equal(slots.find(s => s.key === '2026-11-03')?.state, 'missed')
  assert.equal(slots.find(s => s.key === '2026-11-04')?.state, 'saved')
})

test('buildSlotsWat: a weekly plan has one slot per week from the WAT start day', () => {
  const slots = buildSlotsWat(
    { startDate: weeklyPlan.startDate.toISOString(), maturityDate: weeklyPlan.maturityDate.toISOString(), periodDays: 42, cadence: 'weekly' },
    [], ['2026-11-09'], at('2026-11-10T12:00:00Z'),
  )
  assert.deepEqual(slots.slice(0, 3).map(s => [s.key, s.state]), [
    ['2026-11-02', 'missed'],
    ['2026-11-09', 'saved'],
    ['2026-11-16', 'upcoming'],
  ])
})

test('isCycleCovered daily: matches the WAT day of the cycle, not the UTC day', () => {
  const covered = ['2026-11-04']
  assert.equal(isCycleCovered(dailyPlan, covered, at('2026-11-03T22:59:00Z')), false) // 23:59 WAT Nov 3
  assert.equal(isCycleCovered(dailyPlan, covered, at('2026-11-03T23:30:00Z')), true) // 00:30 WAT Nov 4
  assert.equal(isCycleCovered(dailyPlan, covered, at('2026-11-04T12:00:00Z')), true)
  assert.equal(isCycleCovered(dailyPlan, covered, at('2026-11-04T23:00:00Z')), false) // 00:00 WAT Nov 5
})

test('isCycleCovered weekly: a misaligned cycle date inside a covered week slot is covered', () => {
  // Week slots start Nov 2, Nov 9, Nov 16 (WAT). The mandate was created midweek, so cycles fall on Thursdays.
  const covered = ['2026-11-09']
  assert.equal(isCycleCovered(weeklyPlan, covered, at('2026-11-05T08:00:00Z')), false) // week 1
  assert.equal(isCycleCovered(weeklyPlan, covered, at('2026-11-12T08:00:00Z')), true) // week 2
  assert.equal(isCycleCovered(weeklyPlan, covered, at('2026-11-19T08:00:00Z')), false) // week 3
})

test('isCycleCovered weekly: slot edges in WAT', () => {
  const covered = ['2026-11-09']
  assert.equal(isCycleCovered(weeklyPlan, covered, at('2026-11-08T22:59:00Z')), false) // 23:59 WAT Nov 8, last of week 1
  assert.equal(isCycleCovered(weeklyPlan, covered, at('2026-11-08T23:00:00Z')), true) // 00:00 WAT Nov 9, first of week 2
  assert.equal(isCycleCovered(weeklyPlan, covered, at('2026-11-15T22:59:00Z')), true) // 23:59 WAT Nov 15, last of week 2
  assert.equal(isCycleCovered(weeklyPlan, covered, at('2026-11-15T23:00:00Z')), false) // 00:00 WAT Nov 16, first of week 3
})

test('isCycleCovered weekly: a cycle before the plan starts is never covered', () => {
  assert.equal(isCycleCovered(weeklyPlan, ['2026-11-02'], at('2026-10-30T08:00:00Z')), false)
})

test('isCycleCovered: monthly plans are never covered, and no coverage means no skip', () => {
  assert.equal(isCycleCovered({ ...dailyPlan, cadence: 'monthly' }, ['2026-11-04'], at('2026-11-04T12:00:00Z')), false)
  assert.equal(isCycleCovered(dailyPlan, [], at('2026-11-04T12:00:00Z')), false)
  assert.equal(isCycleCovered(weeklyPlan, [], at('2026-11-12T08:00:00Z')), false)
})

test('inFlightKeys: maps each attempt to the slot key a customer would pick', () => {
  assert.deepEqual(inFlightKeys(dailyPlan, [{ cycleDate: at('2026-11-03T23:30:00Z') }]), ['2026-11-04'])
  assert.deepEqual(inFlightKeys(weeklyPlan, [{ cycleDate: at('2026-11-12T08:00:00Z') }]), ['2026-11-09'])
  assert.deepEqual(inFlightKeys({ ...dailyPlan, cadence: 'monthly' }, [{ cycleDate: at('2026-11-03T12:00:00Z') }]), [])
})

test('nextPaymentDate: no coverage returns nextRunAt itself', () => {
  const run = at('2026-11-04T08:00:00Z')
  assert.equal(nextPaymentDate({ plan: dailyPlan, nextRunAt: run, coveredKeys: [], now: at('2026-11-03T08:00:00Z') })?.toISOString(), run.toISOString())
})

test('nextPaymentDate daily: walks past covered days to the next day really charged', () => {
  const next = nextPaymentDate({
    plan: dailyPlan, nextRunAt: at('2026-11-04T08:00:00Z'), coveredKeys: ['2026-11-04', '2026-11-05'], now: at('2026-11-03T08:00:00Z'),
  })
  assert.equal(next?.toISOString(), '2026-11-06T08:00:00.000Z')
})

test('nextPaymentDate weekly: walks past a covered week by slot, not by key', () => {
  const next = nextPaymentDate({
    plan: weeklyPlan, nextRunAt: at('2026-11-12T08:00:00Z'), coveredKeys: ['2026-11-09', '2026-11-16'], now: at('2026-11-10T08:00:00Z'),
  })
  assert.equal(next?.toISOString(), '2026-11-26T08:00:00.000Z')
})

test('nextPaymentDate: null when everything left is covered up to maturity', () => {
  const all = Array.from({ length: 10 }, (_, i) => `2026-11-${String(i + 2).padStart(2, '0')}`)
  assert.equal(nextPaymentDate({ plan: dailyPlan, nextRunAt: at('2026-11-04T08:00:00Z'), coveredKeys: all, now: at('2026-11-03T08:00:00Z') }), null)
})

test('nextPaymentDate: null at or past maturity, and on a plan that is not running', () => {
  const now = at('2026-11-03T08:00:00Z')
  assert.equal(nextPaymentDate({ plan: dailyPlan, nextRunAt: dailyPlan.maturityDate, coveredKeys: [], now }), null)
  assert.equal(nextPaymentDate({ plan: { ...dailyPlan, status: 'Completed' }, nextRunAt: at('2026-11-04T08:00:00Z'), coveredKeys: [], now }), null)
})

test('nextPaymentDate: an overdue run is judged on the day the cron will really charge', () => {
  // nextRunAt was yesterday and today is covered: the cron skips today, so the next charge is tomorrow.
  const next = nextPaymentDate({
    plan: dailyPlan, nextRunAt: at('2026-11-04T08:00:00Z'), coveredKeys: ['2026-11-05'], now: at('2026-11-05T08:00:00Z'),
  })
  assert.equal(next?.toISOString(), '2026-11-06T08:00:00.000Z')
})

test('the walk agrees with what the cron would do, every day to maturity', () => {
  const covered = ['2026-11-04', '2026-11-05', '2026-11-08']
  let run = at('2026-11-03T08:00:00Z')
  const charged: string[] = []
  while (run.getTime() < dailyPlan.maturityDate.getTime()) {
    if (!isCycleCovered(dailyPlan, covered, run)) charged.push(run.toISOString())
    run = nextRunAt(run, 'daily')
  }
  assert.ok(charged.length > 0, 'never skips forever')
  assert.ok(!charged.some(d => covered.includes(watKey(new Date(d)))), 'never charges a covered day')
  assert.equal(
    nextPaymentDate({ plan: dailyPlan, nextRunAt: at('2026-11-04T08:00:00Z'), coveredKeys: covered, now: at('2026-11-03T09:00:00Z') })?.toISOString(),
    charged[1],
  )
})

test('the pending hold is about an hour', () => {
  assert.equal(PENDING_HOLD_MS, 60 * 60 * 1000)
})

test('isCycleInPlan daily: first and last slot in, the day before and the maturity day out', () => {
  assert.equal(isCycleInPlan(dailyPlan, at('2026-11-01T22:00:00Z')), false) // 23:00 WAT Nov 1, before the start
  assert.equal(isCycleInPlan(dailyPlan, at('2026-11-02T08:00:00Z')), true)
  assert.equal(isCycleInPlan(dailyPlan, at('2026-11-11T08:00:00Z')), true) // last slot
  assert.equal(isCycleInPlan(dailyPlan, at('2026-11-12T08:00:00Z')), false) // maturity day
})

test('isCycleInPlan weekly: runs to the end of the last week slot', () => {
  assert.equal(isCycleInPlan(weeklyPlan, at('2026-10-30T08:00:00Z')), false)
  assert.equal(isCycleInPlan(weeklyPlan, at('2026-12-13T08:00:00Z')), true) // day 42, last of week 6
  assert.equal(isCycleInPlan(weeklyPlan, at('2026-12-14T08:00:00Z')), false)
})

const dep = (iso: string, amount: number) => ({ createdAt: at(iso), amount })

test('isSlotFunded daily: exact amount funds it, one naira under does not', () => {
  const cycle = at('2026-11-04T12:00:00Z')
  assert.equal(isSlotFunded(dailyPlan, [dep('2026-11-04T09:00:00Z', 100)], cycle), true)
  assert.equal(isSlotFunded(dailyPlan, [dep('2026-11-04T09:00:00Z', 99)], cycle), false)
})

test('isSlotFunded daily: several small deposits add up', () => {
  const cycle = at('2026-11-04T12:00:00Z')
  assert.equal(isSlotFunded(dailyPlan, [dep('2026-11-04T07:00:00Z', 40), dep('2026-11-04T09:00:00Z', 60)], cycle), true)
  // Decimal money must not fall short through float addition.
  assert.equal(isSlotFunded({ ...dailyPlan, dailyAmount: 0.3 }, [dep('2026-11-04T07:00:00Z', 0.1), dep('2026-11-04T09:00:00Z', 0.2)], cycle), true)
})

test('isSlotFunded daily: only the same WAT day counts', () => {
  const cycle = at('2026-11-04T12:00:00Z')
  assert.equal(isSlotFunded(dailyPlan, [dep('2026-11-03T22:59:00Z', 100)], cycle), false) // 23:59 WAT Nov 3
  assert.equal(isSlotFunded(dailyPlan, [dep('2026-11-03T23:00:00Z', 100)], cycle), true) // 00:00 WAT Nov 4
})

test('isSlotFunded weekly: needs a full week across the slot, not just the cycle day', () => {
  const cycle = at('2026-11-12T08:00:00Z') // week 2, Nov 9-15 in WAT
  assert.equal(isSlotFunded(weeklyPlan, [dep('2026-11-09T08:00:00Z', 300), dep('2026-11-14T08:00:00Z', 400)], cycle), true)
  assert.equal(isSlotFunded(weeklyPlan, [dep('2026-11-09T08:00:00Z', 300), dep('2026-11-14T08:00:00Z', 399)], cycle), false)
  assert.equal(isSlotFunded(weeklyPlan, [dep('2026-11-08T08:00:00Z', 700)], cycle), false) // last week's money
})

test('isSlotFunded: a monthly plan has no slot to fund', () => {
  assert.equal(isSlotFunded({ ...dailyPlan, cadence: 'monthly' }, [dep('2026-11-04T09:00:00Z', 9999)], at('2026-11-04T12:00:00Z')), false)
})

test('ordinaryDeposits: drops only coverage payments', () => {
  const rows = [
    { ref: 'PLAIN', amount: 1, createdAt: at('2026-11-04T09:00:00Z') },
    { ref: 'BULK', amount: 2, createdAt: at('2026-11-04T09:00:00Z') },
    { ref: 'autodebit-p-20261104', amount: 3, createdAt: at('2026-11-04T09:00:00Z') },
  ]
  assert.deepEqual(ordinaryDeposits(rows, ['BULK']).map(r => r.ref), ['PLAIN', 'autodebit-p-20261104'])
})

test('nextPaymentDate: walks past a day funded by plain deposits', () => {
  const next = nextPaymentDate({
    plan: dailyPlan, nextRunAt: at('2026-11-04T08:00:00Z'), coveredKeys: [], plainDeposits: [dep('2026-11-04T07:00:00Z', 100)], now: at('2026-11-04T07:30:00Z'),
  })
  assert.equal(next?.toISOString(), '2026-11-05T08:00:00.000Z')
})

test('nextPaymentDate: a part-funded day is still charged', () => {
  const next = nextPaymentDate({
    plan: dailyPlan, nextRunAt: at('2026-11-04T08:00:00Z'), coveredKeys: [], plainDeposits: [dep('2026-11-04T07:00:00Z', 99)], now: at('2026-11-04T07:30:00Z'),
  })
  assert.equal(next?.toISOString(), '2026-11-04T08:00:00.000Z')
})

test('nextPaymentDate: a future-start plan first charges inside the plan', () => {
  const next = nextPaymentDate({ plan: dailyPlan, nextRunAt: at('2026-10-30T08:00:00Z'), coveredKeys: [], now: at('2026-10-29T08:00:00Z') })
  assert.equal(next?.toISOString(), '2026-11-02T08:00:00.000Z')
})

test('nextPaymentDate: the maturity day is not a charge, even before the maturity instant', () => {
  // The last slot is Nov 11. A run on Nov 12 at 08:00 UTC is still before the maturity instant, but outside the plan.
  const later = { ...dailyPlan, maturityDate: at('2026-11-12T10:00:00Z') }
  assert.equal(nextPaymentDate({ plan: later, nextRunAt: at('2026-11-12T08:00:00Z'), coveredKeys: [], now: at('2026-11-11T08:00:00Z') }), null)
})
