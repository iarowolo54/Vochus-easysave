import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoDebitCadence, nextRunAt, nextRunAfter, cycleAmount, cycleCreditAmount } from '../src/lib/auto-debit-schedule'

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day))

test('autoDebitCadence maps each plan cadence to itself (daily is daily)', () => {
  assert.equal(autoDebitCadence('daily'), 'daily')
  assert.equal(autoDebitCadence('weekly'), 'weekly')
  assert.equal(autoDebitCadence('monthly'), 'monthly')
})

test('nextRunAt daily adds 1 day', () => {
  assert.equal(nextRunAt(d(2026, 1, 1), 'daily').toISOString(), d(2026, 1, 2).toISOString())
})

test('nextRunAt weekly adds 7 days', () => {
  assert.equal(nextRunAt(d(2026, 1, 1), 'weekly').toISOString(), d(2026, 1, 8).toISOString())
})

test('nextRunAt monthly clamps to month end', () => {
  assert.equal(nextRunAt(d(2026, 1, 31), 'monthly').toISOString(), d(2026, 2, 28).toISOString())
  assert.equal(nextRunAt(d(2026, 1, 15), 'monthly').toISOString(), d(2026, 2, 15).toISOString())
})

test('cycleCreditAmount daily plan charges one day, zero at/after maturity', () => {
  const cycle = d(2026, 1, 1)
  assert.equal(cycleCreditAmount({ dailyAmount: 100, cadence: 'daily', maturityDate: d(2026, 12, 1) }, cycle), 100)
  assert.equal(cycleCreditAmount({ dailyAmount: 100, cadence: 'daily', maturityDate: d(2026, 1, 4) }, cycle), 100)
  assert.equal(cycleCreditAmount({ dailyAmount: 100, cadence: 'daily', maturityDate: cycle }, cycle), 0)
  assert.equal(cycleCreditAmount({ dailyAmount: 100, cadence: 'daily', maturityDate: d(2025, 12, 1) }, cycle), 0)
})

test('cycleCreditAmount weekly/monthly charge dailyAmount', () => {
  assert.equal(cycleCreditAmount({ dailyAmount: 1000, cadence: 'weekly', maturityDate: d(2026, 12, 1) }, d(2026, 1, 1)), 1000)
  assert.equal(cycleCreditAmount({ dailyAmount: 1000, cadence: 'monthly', maturityDate: d(2026, 12, 1) }, d(2026, 1, 1)), 1000)
})

const at = (y: number, m: number, day: number, h: number, min: number, s: number) => new Date(Date.UTC(y, m - 1, day, h, min, s))

test('nextRunAfter counts from the boundary, so a run a few seconds late does not push tomorrow back', () => {
  const due = at(2026, 1, 1, 6, 0, 0)
  const ranAt = at(2026, 1, 1, 6, 0, 3)
  const next = nextRunAfter(due, ranAt, 'daily')
  assert.equal(next.toISOString(), at(2026, 1, 2, 6, 0, 0).toISOString())
  // The next morning's cron fires a second after 06:00 and finds it due, where counting from the run would not.
  assert.ok(at(2026, 1, 2, 6, 0, 1).getTime() >= next.getTime())
  assert.ok(at(2026, 1, 2, 6, 0, 1).getTime() < nextRunAt(ranAt, 'daily').getTime(), 'the old rule would have skipped the day')
})

test('nextRunAfter moves past now when cron missed days, charging once, not once per missed day', () => {
  const next = nextRunAfter(at(2026, 1, 1, 6, 0, 0), at(2026, 1, 4, 6, 0, 5), 'daily')
  assert.equal(next.toISOString(), at(2026, 1, 5, 6, 0, 0).toISOString())
  assert.equal(nextRunAfter(at(2026, 1, 1, 6, 0, 0), at(2026, 1, 8, 6, 0, 0), 'weekly').toISOString(), at(2026, 1, 15, 6, 0, 0).toISOString())
})

test('cycleAmount: weekly and monthly charge one day until the switch is on, then 7 and 30 days; daily never changes', () => {
  const before = process.env.AUTO_DEBIT_FULL_CYCLE_AMOUNT
  try {
    delete process.env.AUTO_DEBIT_FULL_CYCLE_AMOUNT
    assert.equal(cycleAmount({ dailyAmount: 100, cadence: 'daily' }), 100)
    assert.equal(cycleAmount({ dailyAmount: 100, cadence: 'weekly' }), 100)
    assert.equal(cycleAmount({ dailyAmount: 100, cadence: 'monthly' }), 100)
    process.env.AUTO_DEBIT_FULL_CYCLE_AMOUNT = '1'
    assert.equal(cycleAmount({ dailyAmount: 100, cadence: 'daily' }), 100)
    assert.equal(cycleAmount({ dailyAmount: 100, cadence: 'weekly' }), 700)
    assert.equal(cycleAmount({ dailyAmount: 100, cadence: 'monthly' }), 3000)
    assert.equal(cycleCreditAmount({ dailyAmount: 100, cadence: 'weekly', maturityDate: d(2026, 12, 1) }, d(2026, 1, 1)), 700)
    assert.equal(cycleCreditAmount({ dailyAmount: 100, cadence: 'weekly', maturityDate: d(2026, 1, 1) }, d(2026, 1, 1)), 0, 'still nothing at maturity')
    process.env.AUTO_DEBIT_FULL_CYCLE_AMOUNT = 'true'
    assert.equal(cycleAmount({ dailyAmount: 100, cadence: 'weekly' }), 100, 'only the exact value 1 turns it on')
  } finally {
    if (before === undefined) delete process.env.AUTO_DEBIT_FULL_CYCLE_AMOUNT
    else process.env.AUTO_DEBIT_FULL_CYCLE_AMOUNT = before
  }
})
