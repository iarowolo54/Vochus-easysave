import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitDaysByPlan } from '../src/lib/calendar-plans'

const tx = (planId: string | null, day: number, amount: number) => ({ planId, amount, ref: `R${day}`, createdAt: new Date(2026, 10, day, 9, 30) })

test('each plan gets only its own savings', () => {
  const r = splitDaysByPlan([{ id: 'new' }, { id: 'old' }], [tx('new', 2, 500), tx('old', 2, 1000), tx('old', 3, 1000)])
  assert.equal(r.new[2].amount, 500)
  assert.equal(r.new[3], undefined)
  assert.equal(r.old[2].amount, 1000)
  assert.equal(r.old[3].amount, 1000)
})

test('several savings on one day add up', () => {
  const r = splitDaysByPlan([{ id: 'a' }], [tx('a', 5, 300), tx('a', 5, 200)])
  assert.equal(r.a[5].amount, 500)
})

test('savings on a closed or unrecorded plan go to the newest plan', () => {
  const r = splitDaysByPlan([{ id: 'new' }, { id: 'old' }], [tx('closed', 4, 700), tx(null, 6, 100)])
  assert.equal(r.new[4].amount, 700)
  assert.equal(r.new[6].amount, 100)
  assert.deepEqual(r.old, {})
})

test('no plans gives no calendars', () => {
  assert.deepEqual(splitDaysByPlan([], [tx('x', 1, 100)]), {})
})
