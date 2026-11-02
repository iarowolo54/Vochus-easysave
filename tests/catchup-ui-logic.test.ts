// Unit test: pure helpers used by the customer catch-up screen
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allMissedChosen, missedKeys, readableKey, selectableKeys, selectionTotal, slotSummary, toggleAllMissed, MAX_CATCHUP_KEYS } from '../src/lib/catchup'
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

test('toggleAllMissed: once all are chosen, removes the missed slots and keeps future picks', () => {
  assert.deepEqual([...toggleAllMissed(new Set(['F1', 'M1', 'M2']), ['M1', 'M2'], 90)], ['F1'])
})

test('toggleAllMissed: stops at the cap, then the next tap removes them', () => {
  const missed = Array.from({ length: 100 }, (_, i) => `M${i}`)
  const capped = toggleAllMissed(new Set(), missed, 90)
  assert.equal(capped.size, 90)
  assert.equal(allMissedChosen(capped, missed, 90), true)
  assert.equal(toggleAllMissed(capped, missed, 90).size, 0)
})

test('allMissedChosen: a cap full of future picks has nothing of select-all to clear', () => {
  assert.equal(allMissedChosen(new Set(['F1', 'F2']), ['M1'], 2), false)
  assert.equal(allMissedChosen(new Set(['F1', 'M1']), ['M1', 'M2'], 2), true)
})

test('allMissedChosen: false with no selection, no missed slots, or a missed slot left over', () => {
  assert.equal(allMissedChosen(new Set(), ['M1'], 90), false)
  assert.equal(allMissedChosen(new Set(['F1']), [], 90), false)
  assert.equal(allMissedChosen(new Set(['M1']), ['M1', 'M2'], 90), false)
  assert.equal(allMissedChosen(new Set(['M1', 'M2']), ['M1', 'M2'], 90), true)
})

test('selectionTotal: rate x count, weekly is 7x, never negative', () => {
  assert.equal(selectionTotal({ cadence: 'daily', dailyAmount: 150 }, 3), 450)
  assert.equal(selectionTotal({ cadence: 'weekly', dailyAmount: 100 }, 2), 1400)
  assert.equal(selectionTotal({ dailyAmount: 100 }, -1), 0)
  assert.equal(MAX_CATCHUP_KEYS, 90)
})

test('readableKey: a date a customer can read, in any timezone', () => {
  assert.equal(readableKey('2026-11-03'), '3 Nov')
  assert.equal(readableKey('garbage'), 'That day')
})

const week = (key: string, index: number): Slot => ({ key, date: new Date(key), index, state: 'upcoming', coveredOnly: false })
const weeks = [week('2026-11-02', 1), week('2026-11-09', 2), week('2026-11-16', 3), week('2026-11-23', 4), week('2026-11-30', 5)]

test('slotSummary: nothing for a daily plan or no selection', () => {
  assert.equal(slotSummary(weeks, new Set(), true), '')
  assert.equal(slotSummary(weeks, new Set(['2026-11-02']), false), '')
})

test('slotSummary: one week', () => {
  assert.equal(slotSummary(weeks, new Set(['2026-11-09']), true), 'Week 2 · 9 Nov – 15 Nov')
})

test('slotSummary: a run of weeks', () => {
  assert.equal(slotSummary(weeks, new Set(['2026-11-16', '2026-11-09', '2026-11-23']), true), 'Weeks 2–4 · 9 Nov – 29 Nov')
})

test('slotSummary: separate weeks list each run', () => {
  assert.equal(
    slotSummary(weeks, new Set(['2026-11-02', '2026-11-16', '2026-11-23']), true),
    'Weeks 1, 3–4 · 2 Nov – 8 Nov, 16 Nov – 29 Nov',
  )
})
