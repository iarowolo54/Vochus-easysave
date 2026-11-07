// Unit test: flexible savings settings, the minimum-term rule and what is taken when the customer collects.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_FLEXIBLE_SETTINGS as D, flexibleDeduction, isEarlyCollection, isFlexible, parseCadence,
  parseFlexibleSettings, resolveFlexiblePlan, validateFlexibleSettings,
} from '../src/lib/flexible-savings'

const NOW = new Date(2026, 10, 7, 9, 0) // 7 Nov 2026, local

test('defaults are the agreed starting values', () => {
  assert.deepEqual(D, { minTermMonths: 3, minDeposit: 100, cashCommissionPct: 5, cashCommissionAgentPct: 60, penaltyPct: 5, penaltyAgentPct: 40 })
})

test('a missing or broken settings row falls back field by field', () => {
  assert.deepEqual(parseFlexibleSettings(null), D)
  assert.deepEqual(parseFlexibleSettings('nonsense'), D)
  assert.deepEqual(parseFlexibleSettings({ penaltyPct: 'x', minDeposit: 50 }), { ...D, minDeposit: 50 })
  assert.deepEqual(parseFlexibleSettings({ penaltyPct: -1, minTermMonths: 0 }), D)
})

test('validation refuses out-of-range values and accepts the defaults', () => {
  assert.equal(validateFlexibleSettings({ ...D, penaltyPct: 26 }).ok, false)
  assert.equal(validateFlexibleSettings({ ...D, cashCommissionPct: 30 }).ok, false)
  assert.equal(validateFlexibleSettings({ ...D, minTermMonths: 0 }).ok, false)
  assert.equal(validateFlexibleSettings({ ...D, minTermMonths: 2.5 }).ok, false)
  assert.equal(validateFlexibleSettings({ ...D, cashCommissionAgentPct: 101 }).ok, false)
  assert.equal(validateFlexibleSettings({ ...D, minDeposit: -5 }).ok, false)
  assert.equal(validateFlexibleSettings(null).ok, false)
  assert.deepEqual(validateFlexibleSettings({ ...D, extra: 1 }), { ok: true, settings: D })
})

test('cadence: blank is daily, flexible is known, anything else is refused', () => {
  assert.equal(parseCadence(undefined), 'daily')
  assert.equal(parseCadence(''), 'daily')
  assert.equal(parseCadence('flexible'), 'flexible')
  assert.equal(parseCadence('weekly'), 'weekly')
  assert.equal(parseCadence('yearly'), null)
  assert.equal(parseCadence(7), null)
  assert.equal(isFlexible('flexible'), true)
  assert.equal(isFlexible('daily'), false)
  assert.equal(isFlexible(null), false)
})

test('exactly three months is allowed and gives the right length', () => {
  const r = resolveFlexiblePlan({ startDate: '2026-11-10', endDate: '2027-02-10' }, D, NOW)
  assert.ok(!('error' in r))
  assert.equal(r.periodDays, 92)
  assert.equal(r.maturityDate.getTime(), new Date(2027, 1, 10).getTime())
  assert.equal(r.startDate.getTime(), new Date(2026, 10, 10).getTime())
})

test('a day short of three months is refused with the earliest allowed date', () => {
  const r = resolveFlexiblePlan({ startDate: '2026-11-10', endDate: '2027-02-09' }, D, NOW)
  assert.ok('error' in r)
  assert.match(r.error, /at least 3 months/)
  assert.match(r.error, /10 Feb 2027/)
})

test('month ends clamp: 30 Nov to 28 Feb is three months', () => {
  const r = resolveFlexiblePlan({ startDate: '2026-11-30', endDate: '2027-02-28' }, D, NOW)
  assert.ok(!('error' in r))
})

test('missing, invalid or too-distant end dates are refused', () => {
  const missing = resolveFlexiblePlan({ startDate: '2026-11-10', endDate: '' }, D, NOW)
  assert.deepEqual(missing, { error: 'Choose an end date.' })
  assert.ok('error' in resolveFlexiblePlan({ startDate: '2026-11-10', endDate: '2027-02-31' }, D, NOW))
  const far = resolveFlexiblePlan({ startDate: '2026-11-10', endDate: '2032-11-10' }, D, NOW)
  assert.deepEqual(far, { error: 'That end date is too far away.' })
})

test('a start date in the past is refused', () => {
  assert.ok('error' in resolveFlexiblePlan({ startDate: '2026-11-01', endDate: '2027-03-01' }, D, NOW))
})

test('a blank start date means today', () => {
  const r = resolveFlexiblePlan({ startDate: '', endDate: '2027-02-07' }, D, NOW)
  assert.ok(!('error' in r))
})

const mat = new Date(2027, 1, 10) // local midnight, as plans store it

test('collecting on the end date itself is not early', () => {
  assert.equal(isEarlyCollection(mat, new Date(2027, 1, 10, 0, 30)), false)
  assert.equal(isEarlyCollection(mat, new Date(2027, 1, 10, 23, 59)), false)
  assert.equal(isEarlyCollection(new Date(2027, 1, 10, 15, 0), new Date(2027, 1, 10, 8, 0)), false)
  assert.equal(isEarlyCollection(mat, new Date(2027, 1, 9, 23, 30)), true)
})

test('cash plan stopped early pays commission and penalty', () => {
  assert.deepEqual(
    flexibleDeduction({ source: 'agent', balance: 10000, maturityDate: mat, at: new Date(2027, 0, 1) }, D),
    { commission: 500, penalty: 500, deduction: 1000, feeAgent: 500, early: true },
  )
})

test('cash plan at the end pays commission only', () => {
  assert.deepEqual(
    flexibleDeduction({ source: 'agent', balance: 10000, maturityDate: mat, at: new Date(2027, 1, 11) }, D),
    { commission: 500, penalty: 0, deduction: 500, feeAgent: 300, early: false },
  )
})

test('online plan stopped early pays the penalty only; at the end pays nothing', () => {
  assert.deepEqual(
    flexibleDeduction({ source: 'self', balance: 10000, maturityDate: mat, at: new Date(2027, 0, 1) }, D),
    { commission: 0, penalty: 500, deduction: 500, feeAgent: 200, early: true },
  )
  assert.deepEqual(
    flexibleDeduction({ source: 'self', balance: 10000, maturityDate: mat, at: new Date(2027, 1, 10, 12) }, D),
    { commission: 0, penalty: 0, deduction: 0, feeAgent: 0, early: false },
  )
})

test('the deduction never exceeds the balance, and the agent part never exceeds the deduction', () => {
  const s = { ...D, cashCommissionPct: 25, penaltyPct: 25, cashCommissionAgentPct: 100, penaltyAgentPct: 100 }
  for (const balance of [0, 0.01, 1, 3.33]) {
    const d = flexibleDeduction({ source: 'agent', balance, maturityDate: mat, at: new Date(2027, 0, 1) }, s)
    assert.ok(d.deduction <= balance, `deduction ${d.deduction} > balance ${balance}`)
    assert.ok(d.feeAgent <= d.deduction, `agent ${d.feeAgent} > deduction ${d.deduction}`)
    assert.ok(d.deduction >= 0 && d.feeAgent >= 0)
  }
})

test('flexiblePlanData ignores any amount and returns the plan fields', async () => {
  const { flexiblePlanData } = await import('../src/lib/flexible-savings')
  const r = flexiblePlanData({ startDate: '2026-11-10', endDate: '2027-02-10' }, D, NOW)
  assert.ok(!('error' in r))
  assert.equal(r.cadence, 'flexible')
  assert.equal(r.dailyAmount, 0)
  assert.equal(r.periodDays, 92)
  assert.ok('error' in flexiblePlanData({ startDate: '2026-11-10', endDate: '2027-01-10' }, D, NOW))
})
