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
