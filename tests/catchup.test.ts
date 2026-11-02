// Unit test: pure catch-up math (src/lib/catchup.ts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { perSlotAmount, isEligiblePlan, validateSelection } from '../src/lib/catchup'
import type { Slot } from '../src/lib/savings-card'

function slot(key: string, state: Slot['state']): Slot {
  return { key, date: new Date(key), index: 1, state, coveredOnly: false }
}

test('perSlotAmount: daily = dailyAmount, weekly = dailyAmount*7', () => {
  assert.equal(perSlotAmount({ cadence: 'daily', dailyAmount: 100 }), 100)
  assert.equal(perSlotAmount({ cadence: 'weekly', dailyAmount: 100 }), 700)
  // cadence defaults to daily
  assert.equal(perSlotAmount({ dailyAmount: 250 }), 250)
})

test('isEligiblePlan: only Active + self + daily|weekly', () => {
  assert.equal(isEligiblePlan({ status: 'Active', source: 'self', cadence: 'daily' }), true)
  assert.equal(isEligiblePlan({ status: 'Active', source: 'self', cadence: 'weekly' }), true)
  // monthly cadence rejected
  assert.equal(isEligiblePlan({ status: 'Active', source: 'self', cadence: 'monthly' }), false)
  // offline/agent plan rejected
  assert.equal(isEligiblePlan({ status: 'Active', source: 'agent', cadence: 'daily' }), false)
  // non-active rejected
  assert.equal(isEligiblePlan({ status: 'Completed', source: 'self', cadence: 'daily' }), false)
})

test('validateSelection: accepts missed, today and upcoming slots with the correct total', () => {
  const slots = [
    slot('2026-01-01', 'saved'),
    slot('2026-01-02', 'missed'),
    slot('2026-01-03', 'missed'),
    slot('2026-01-04', 'today'),
    slot('2026-01-05', 'upcoming'),
  ]
  const r = validateSelection({ cadence: 'daily', dailyAmount: 100 }, slots, ['2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'])
  assert.deepEqual(r, { ok: true, total: 400 })
})

test('validateSelection: rejects a saved key, even alongside valid ones', () => {
  const slots = [slot('2026-01-01', 'saved'), slot('2026-01-02', 'missed'), slot('2026-01-04', 'today')]
  assert.equal(validateSelection({ cadence: 'daily', dailyAmount: 100 }, slots, ['2026-01-01']).ok, false)
  assert.equal(validateSelection({ cadence: 'daily', dailyAmount: 100 }, slots, ['2026-01-02', '2026-01-01']).ok, false)
  // an unknown key (not a slot at all)
  assert.equal(validateSelection({ cadence: 'daily', dailyAmount: 100 }, slots, ['2026-01-09']).ok, false)
})

test('validateSelection: rejects a duplicate key', () => {
  const slots = [slot('2026-01-02', 'missed'), slot('2026-01-03', 'missed')]
  assert.equal(validateSelection({ cadence: 'daily', dailyAmount: 100 }, slots, ['2026-01-02', '2026-01-02']).ok, false)
})

test('validateSelection: rejects empty and >90', () => {
  const slots = Array.from({ length: 100 }, (_, i) => slot(`2026-02-${String(i + 1).padStart(2, '0')}`, 'missed'))
  assert.equal(validateSelection({ cadence: 'daily', dailyAmount: 100 }, slots, []).ok, false)
  const keys = slots.slice(0, 91).map(s => s.key)
  assert.equal(validateSelection({ cadence: 'daily', dailyAmount: 100 }, slots, keys).ok, false)
})

test('validateSelection: weekly total uses dailyAmount*7 per slot', () => {
  const slots = [slot('2026-01-05', 'missed'), slot('2026-01-12', 'missed')]
  const r = validateSelection({ cadence: 'weekly', dailyAmount: 100 }, slots, ['2026-01-05', '2026-01-12'])
  assert.deepEqual(r, { ok: true, total: 1400 })
})

test('validateSelection: the 90-slot cap counts upcoming slots too', () => {
  const slots = Array.from({ length: 100 }, (_, i) => slot(`K${i}`, 'upcoming'))
  assert.equal(validateSelection({ dailyAmount: 100 }, slots, slots.slice(0, 90).map(s => s.key)).ok, true)
  assert.equal(validateSelection({ dailyAmount: 100 }, slots, slots.slice(0, 91).map(s => s.key)).ok, false)
})
