import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoDebitCadence, nextRunAt, cycleCreditAmount } from '../src/lib/auto-debit-schedule'

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
