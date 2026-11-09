// Unit test: a fixed plan takes one ordinary payment per day/week/month. Flexible and Ajo plans have no such limit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSlotsWat, periodAlreadySaved } from '../src/lib/savings-card'

const at = (key: string) => `${key}T09:00:00.000Z`
const plan = (cadence: string, periodDays: number) => ({
  startDate: at('2026-11-02'), maturityDate: at('2027-03-01'), periodDays, cadence,
})
const slotsOf = (cadence: string, periodDays: number, deposits: string[], covered: string[], today: string) =>
  buildSlotsWat(plan(cadence, periodDays), deposits.map(at), covered, new Date(at(today)))

test('daily: paid today blocks another payment today', () => {
  assert.equal(periodAlreadySaved(slotsOf('daily', 30, ['2026-11-09'], [], '2026-11-09'), '2026-11-09', 'daily'), true)
})

test('daily: yesterday’s payment does not cover today', () => {
  assert.equal(periodAlreadySaved(slotsOf('daily', 30, ['2026-11-08'], [], '2026-11-09'), '2026-11-09', 'daily'), false)
})

test('daily: today bought through Bulk Savings counts as paid', () => {
  assert.equal(periodAlreadySaved(slotsOf('daily', 30, [], ['2026-11-09'], '2026-11-09'), '2026-11-09', 'daily'), true)
})

test('weekly: paid earlier in the week blocks the rest of that week', () => {
  assert.equal(periodAlreadySaved(slotsOf('weekly', 56, ['2026-11-09'], [], '2026-11-15'), '2026-11-15', 'weekly'), true)
})

test('weekly: last week’s payment does not cover the new week', () => {
  assert.equal(periodAlreadySaved(slotsOf('weekly', 56, ['2026-11-08'], [], '2026-11-09'), '2026-11-09', 'weekly'), false)
})

test('monthly: paid earlier in the 30-day period blocks the rest of it', () => {
  assert.equal(periodAlreadySaved(slotsOf('monthly', 90, ['2026-11-03'], [], '2026-11-20'), '2026-11-20', 'monthly'), true)
})

test('monthly: the next 30-day period is open again', () => {
  assert.equal(periodAlreadySaved(slotsOf('monthly', 90, ['2026-11-03'], [], '2026-12-02'), '2026-12-02', 'monthly'), false)
})

test('flexible and Ajo plans are never blocked', () => {
  assert.equal(periodAlreadySaved(slotsOf('flexible', 90, ['2026-11-09'], [], '2026-11-09'), '2026-11-09', 'flexible'), false)
  assert.equal(periodAlreadySaved(slotsOf('ajo', 30, ['2026-11-09'], [], '2026-11-09'), '2026-11-09', 'ajo'), false)
})

test('a day outside the plan is not blocked', () => {
  assert.equal(periodAlreadySaved(slotsOf('daily', 30, [], [], '2026-11-01'), '2026-11-01', 'daily'), false)
})
