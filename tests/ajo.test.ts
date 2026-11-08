import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSlots, isJoinCode, isRoundFunded, lagosMidnight, openRound, parseNewGroup, potOf, roundDueDay, roundLabel } from '../src/lib/ajo'

const start = lagosMidnight('2026-11-10')

test('round due days: daily, weekly, monthly (month end clamped)', () => {
  assert.equal(roundDueDay(start, 'daily', 1), '2026-11-10')
  assert.equal(roundDueDay(start, 'daily', 3), '2026-11-12')
  assert.equal(roundDueDay(start, 'weekly', 2), '2026-11-17')
  assert.equal(roundDueDay(start, 'monthly', 3), '2027-01-10')
  assert.equal(roundDueDay(lagosMidnight('2027-01-31'), 'monthly', 2), '2027-02-28')
  assert.equal(roundDueDay(lagosMidnight('2027-01-31'), 'monthly', 3), '2027-03-31')
})

test('round labels', () => {
  assert.equal(roundLabel(start, 'weekly', 2), 'Week 2 · 17 Nov')
  assert.equal(roundLabel(start, 'daily', 1), 'Day 1 · 10 Nov')
  assert.equal(roundLabel(start, 'monthly', 2), 'December 2026')
})

test('pot, open round and funded round', () => {
  assert.equal(potOf({ contribution: 5000, size: 6 }), 30000)
  assert.equal(openRound(3, []), 1)
  assert.equal(openRound(3, [1, 2]), 3)
  assert.equal(openRound(3, [1, 2, 3]), null)
  assert.equal(isRoundFunded(['a', 'b'], ['b', 'a']), true)
  assert.equal(isRoundFunded(['a', 'b'], ['a']), false)
  assert.equal(isRoundFunded([], []), false)
})

test('new group: good input', () => {
  const r = parseNewGroup({ name: '  Market  women ', cadence: 'weekly', size: '6', contribution: '5000', startDate: '2026-11-10' }, new Date('2026-11-08T12:00:00Z'))
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.value.name, 'Market women')
    assert.equal(r.value.size, 6)
    assert.equal(r.value.startDate.toISOString(), '2026-11-09T23:00:00.000Z')
  }
})

test('new group: every bad field is named; past start refused', () => {
  const r = parseNewGroup({ name: 'x', cadence: 'yearly', size: 1, contribution: 50.5, startDate: '2026-11-07' }, new Date('2026-11-08T12:00:00Z'))
  assert.ok(!r.ok)
  if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ['cadence', 'contribution', 'name', 'size', 'startDate'])
})

test('slots: complete, unique, members only', () => {
  assert.ok(checkSlots(['a', 'b'], 2, { a: 2, b: 1 }).ok)
  assert.ok(!checkSlots(['a'], 2, { a: 1 }).ok, 'group not full')
  assert.ok(!checkSlots(['a', 'b'], 2, { a: 1, b: 1 }).ok, 'same slot twice')
  assert.ok(!checkSlots(['a', 'b'], 2, { a: 1, b: 3 }).ok, 'slot out of range')
  assert.ok(!checkSlots(['a', 'b'], 2, { a: 1, b: 2, z: 1 }).ok, 'stranger')
})

test('join codes are six digits', () => {
  assert.ok(isJoinCode('012345'))
  assert.ok(!isJoinCode('12345') && !isJoinCode('12345a') && !isJoinCode(123456))
})
