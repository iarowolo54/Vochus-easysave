// Unit test: pure helpers used by the customer catch-up screen
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allMissedChosen, missedKeys, selectableKeys, selectionTotal, toggleAllMissed, MAX_CATCHUP_KEYS } from '../src/lib/catchup'
import type { Slot } from '../src/lib/savings-card'

const slot = (key: string, state: Slot['state']): Slot => ({ key, date: new Date(key), index: 1, state, coveredOnly: false })

test('selectableKeys: everything not yet saved', () => {
  const slots = [slot('2026-10-01', 'saved'), slot('2026-10-02', 'missed'), slot('2026-10-03', 'today'), slot('2026-10-04', 'upcoming')]
  assert.deepEqual(selectableKeys(slots), ['2026-10-02', '2026-10-03', '2026-10-04'])
})

test('missedKeys: only missed slots, so select-all cannot buy the future', () => {
  const slots = [slot('2026-10-01', 'saved'), slot('2026-10-02', 'missed'), slot('2026-10-03', 'today'), slot('2026-10-04', 'upcoming')]
  assert.deepEqual(missedKeys(slots), ['2026-10-02'])
})

test('toggleAllMissed: adds missed slots, keeps future picks, and adds no other future slots', () => {
  const next = toggleAllMissed(new Set(['F1']), ['M1', 'M2'], 90)
  assert.deepEqual([...next].sort(), ['F1', 'M1', 'M2'])
})

test('toggleAllMissed: clears everything once all missed slots are chosen', () => {
  assert.equal(toggleAllMissed(new Set(['F1', 'M1', 'M2']), ['M1', 'M2'], 90).size, 0)
})

test('toggleAllMissed: stops at the cap, then the next tap clears', () => {
  const missed = Array.from({ length: 100 }, (_, i) => `M${i}`)
  const capped = toggleAllMissed(new Set(), missed, 90)
  assert.equal(capped.size, 90)
  assert.equal(allMissedChosen(capped, missed, 90), true)
  assert.equal(toggleAllMissed(capped, missed, 90).size, 0)
})

test('allMissedChosen: false with no selection or a missed slot left over', () => {
  assert.equal(allMissedChosen(new Set(), ['M1'], 90), false)
  assert.equal(allMissedChosen(new Set(['M1']), ['M1', 'M2'], 90), false)
  assert.equal(allMissedChosen(new Set(['M1', 'M2']), ['M1', 'M2'], 90), true)
})

test('selectionTotal: rate x count, weekly is 7x, never negative', () => {
  assert.equal(selectionTotal({ cadence: 'daily', dailyAmount: 150 }, 3), 450)
  assert.equal(selectionTotal({ cadence: 'weekly', dailyAmount: 100 }, 2), 1400)
  assert.equal(selectionTotal({ dailyAmount: 100 }, -1), 0)
  assert.equal(MAX_CATCHUP_KEYS, 90)
})
