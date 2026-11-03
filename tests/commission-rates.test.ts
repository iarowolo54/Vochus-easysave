// Unit test: how the commission rates are read, defaulted and validated.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_COMMISSION_RATES, feeRulesOf, parseCommissionRates, pct, validateRates } from '../src/lib/commission-rates'

const D = DEFAULT_COMMISSION_RATES

test('the defaults are the new savings settings plus the loan ones', () => {
  assert.deepEqual(Object.keys(D).sort(), ['agentLoan', 'agentRepay', 'dailyFirstAgentPct', 'periodicAgentPct', 'periodicFeePct', 'platformLoan', 'platformPenalty'])
  assert.equal(D.dailyFirstAgentPct, 60)
  assert.equal(D.periodicFeePct, 7.5)
  assert.equal(D.periodicAgentPct, 60)
})

test('keeps valid fields and defaults the rest', () => {
  const r = parseCommissionRates({ periodicFeePct: 'x', agentLoan: 2 })
  assert.equal(r.periodicFeePct, D.periodicFeePct)
  assert.equal(r.agentLoan, 2)
})

test('missing or junk input gives the defaults', () => {
  assert.deepEqual(parseCommissionRates(null), D)
  assert.deepEqual(parseCommissionRates('junk'), D)
})

test('old stored savings keys are ignored', () => {
  const r = parseCommissionRates({ agentSavings: 5, platformSavings: 5, agentLoan: 2 })
  assert.equal('agentSavings' in r, false)
  assert.equal(r.agentLoan, 2)
})

test('a negative, over-100 or non-finite stored field falls back to its default', () => {
  const r = parseCommissionRates({ agentRepay: -1, platformLoan: 101, agentLoan: NaN })
  assert.equal(r.agentRepay, D.agentRepay)
  assert.equal(r.platformLoan, D.platformLoan)
  assert.equal(r.agentLoan, D.agentLoan)
})

test('validateRates rejects a missing key, a negative and a value over 100', () => {
  const { agentLoan: _omit, ...missing } = D
  assert.equal(validateRates(missing).ok, false)
  assert.equal(validateRates({ ...D, agentRepay: -1 }).ok, false)
  assert.equal(validateRates({ ...D, dailyFirstAgentPct: 101 }).ok, false)
})

test('validateRates caps the weekly and monthly fee at 25 and the loan rates at their limits', () => {
  assert.equal(validateRates({ ...D, periodicFeePct: 26 }).ok, false)
  assert.equal(validateRates({ ...D, periodicFeePct: 25 }).ok, true)
  assert.equal(validateRates({ ...D, agentLoan: 11 }).ok, false)
  assert.equal(validateRates({ ...D, agentRepay: 11 }).ok, false)
  assert.equal(validateRates({ ...D, platformLoan: 51 }).ok, false)
  assert.equal(validateRates({ ...D, agentLoan: 10, agentRepay: 10, platformLoan: 50 }).ok, true)
})

test('validateRates accepts 0 and 100 for the split percentages', () => {
  assert.equal(validateRates({ ...D, dailyFirstAgentPct: 0, periodicAgentPct: 100 }).ok, true)
})

test('feeRulesOf picks out the three savings settings', () => {
  assert.deepEqual(feeRulesOf({ ...D, dailyFirstAgentPct: 50 }), { dailyFirstAgentPct: 50, periodicFeePct: 7.5, periodicAgentPct: 60 })
})

test('pct takes a percent of an amount and rounds to kobo', () => {
  assert.equal(pct(1000, 0.4), 4)
  assert.equal(pct(33.33, 1.5), 0.5)
})
