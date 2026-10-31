// Unit test: pure helpers used by the customer catch-up screen
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectableKeys, selectionTotal, MAX_CATCHUP_KEYS } from '../src/lib/catchup'
import type { Slot } from '../src/lib/savings-card'

const slot = (key: string, state: Slot['state']): Slot => ({ key, date: new Date(key), index: 1, state, coveredOnly: false })

test('selectableKeys: only missed slots (not today, upcoming or saved)', () => {
  const slots = [slot('2026-10-01', 'saved'), slot('2026-10-02', 'missed'), slot('2026-10-03', 'today'), slot('2026-10-04', 'upcoming')]
  assert.deepEqual(selectableKeys(slots), ['2026-10-02'])
})

test('selectionTotal: rate x count, weekly is 7x, never negative', () => {
  assert.equal(selectionTotal({ cadence: 'daily', dailyAmount: 150 }, 3), 450)
  assert.equal(selectionTotal({ cadence: 'weekly', dailyAmount: 100 }, 2), 1400)
  assert.equal(selectionTotal({ dailyAmount: 100 }, -1), 0)
  assert.equal(MAX_CATCHUP_KEYS, 90)
})
