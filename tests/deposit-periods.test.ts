import { test } from 'node:test'
import assert from 'node:assert/strict'
import { depositPeriodStarts } from '../src/lib/deposit-periods'

test('periods start at WAT midnight, weeks on Monday', () => {
  // Thu 5 Nov 2026 23:30 UTC = Fri 6 Nov 00:30 WAT
  const p = depositPeriodStarts(new Date('2026-11-05T23:30:00Z'))
  assert.equal(p.day.toISOString(), '2026-11-05T23:00:00.000Z') // Fri 6 Nov 00:00 WAT
  assert.equal(p.week.toISOString(), '2026-11-01T23:00:00.000Z') // Mon 2 Nov 00:00 WAT
  assert.equal(p.month.toISOString(), '2026-10-31T23:00:00.000Z') // 1 Nov 00:00 WAT
})

test('a Sunday belongs to the week that began the Monday before', () => {
  const p = depositPeriodStarts(new Date('2026-11-08T10:00:00Z')) // Sun 8 Nov
  assert.equal(p.week.toISOString(), '2026-11-01T23:00:00.000Z')
})

import { summariseDeposits } from '../src/lib/deposit-periods'

test('summary compares with the same stretch before, and builds a running month', () => {
  const now = new Date('2026-11-05T10:00:00Z') // Thu 5 Nov, 11:00 WAT
  const row = (iso: string, amount: number, feeTaken = 0) => ({ createdAt: new Date(iso), amount, feeTaken })
  const s = summariseDeposits([
    row('2026-11-05T08:00:00Z', 1000, 50), // today
    row('2026-11-03T08:00:00Z', 500), // this week
    row('2026-10-29T08:00:00Z', 700), // last week (Thu 29 Oct, inside same stretch Mon–Thu)
    row('2026-10-31T08:00:00Z', 300), // Sat 31 Oct: after the matching stretch ended, so not counted
    row('2026-10-02T08:00:00Z', 400), // last month
  ], now)
  assert.deepEqual(s.day, { total: 1000, count: 1, fees: 50, prevTotal: 0 })
  assert.equal(s.week.total, 1500)
  assert.equal(s.week.prevTotal, 700)
  assert.equal(s.month.total, 1500)
  assert.equal(s.month.prevTotal, 400) // only the first 4.5 days of October count
})
