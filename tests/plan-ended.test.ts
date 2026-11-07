// A plan stops taking deposits once its maturity date has passed, whatever its stored status says.
import test from 'node:test'
import assert from 'node:assert/strict'
import { planHasEnded } from '../src/lib/plan-credit'

const now = new Date('2026-11-03T12:00:00Z')

test('a plan is open before its maturity date', () => {
  assert.equal(planHasEnded({ maturityDate: new Date('2026-11-04T00:00:00Z') }, now), false)
})

test('a plan has ended on and after its maturity date', () => {
  assert.equal(planHasEnded({ maturityDate: now }, now), true)
  assert.equal(planHasEnded({ maturityDate: new Date('2026-10-01T00:00:00Z') }, now), true)
})

// ── Which plans can be saved into, and which days a dated (cash) deposit may be recorded for ──
import { depositDayInPlan, isOpenForSaving, outsidePlanMessage } from '../src/lib/plan-credit'

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)

test('open for saving: Active and before the end date; strings from JSON work too', () => {
  const now = local(2026, 11, 7, 9)
  assert.equal(isOpenForSaving({ status: 'Active', maturityDate: local(2026, 12, 1) }, now), true)
  assert.equal(isOpenForSaving({ status: 'Active', maturityDate: local(2026, 11, 7, 8) }, now), false)
  assert.equal(isOpenForSaving({ status: 'Redeemed', maturityDate: local(2026, 12, 1) }, now), false)
  assert.equal(isOpenForSaving({ status: 'Matured', maturityDate: local(2026, 12, 1) }, now), false)
  assert.equal(isOpenForSaving({ status: 'Active', maturityDate: local(2026, 12, 1).toISOString() }, now), true)
  assert.equal(isOpenForSaving({ status: 'Active', maturityDate: null }, now), false)
})

// A 31-day daily plan started 11 Aug 19:22 runs 11 Aug to 10 Sep; 11 Sep is its end date.
const plan = { startDate: local(2026, 8, 11, 19, 22), maturityDate: local(2026, 9, 11, 19, 22) }

test('a dated deposit must fall on a day the plan runs: from its start day up to the day before its end date', () => {
  assert.equal(depositDayInPlan(plan, local(2026, 8, 11, 12)), true)
  assert.equal(depositDayInPlan(plan, local(2026, 9, 10, 12)), true)
  assert.equal(depositDayInPlan(plan, local(2026, 9, 11, 12)), false)
  assert.equal(depositDayInPlan(plan, local(2026, 10, 7, 12)), false)
  assert.equal(depositDayInPlan(plan, local(2026, 8, 10, 12)), false)
})

test('an unreadable date is never in the plan', () => {
  assert.equal(depositDayInPlan(plan, new Date('not a date')), false)
})

test('a flexible plan ending at midnight on 7 Feb takes deposits dated up to 6 Feb', () => {
  const flex = { startDate: local(2026, 11, 7, 4, 12), maturityDate: local(2027, 2, 7) }
  assert.equal(depositDayInPlan(flex, local(2027, 2, 6, 12)), true)
  assert.equal(depositDayInPlan(flex, local(2027, 2, 7, 12)), false)
})

test('the outside-plan message names the plan’s days and says nothing was charged', () => {
  const m = outsidePlanMessage(plan)
  assert.match(m, /11 Aug 2026/)
  assert.match(m, /10 Sept? 2026/)
  assert.match(m, /Nothing was recorded/)
})
