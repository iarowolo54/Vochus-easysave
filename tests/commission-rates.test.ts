// Unit test: how the commission rates are read, defaulted and validated.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_COMMISSION_RATES, parseCommissionRates, pct, validateRates } from '../src/lib/commission-rates'

test('keeps valid fields and defaults the rest', () => {
  const r = parseCommissionRates({ agentSavings: 'x', agentLoan: 2 })
  assert.equal(r.agentSavings, DEFAULT_COMMISSION_RATES.agentSavings)
  assert.equal(r.agentLoan, 2)
})

test('missing or junk input gives the defaults', () => {
  assert.deepEqual(parseCommissionRates(null), DEFAULT_COMMISSION_RATES)
  assert.deepEqual(parseCommissionRates('junk'), DEFAULT_COMMISSION_RATES)
})

test('a negative, over-100 or non-finite stored field falls back to its default', () => {
  const r = parseCommissionRates({ agentRepay: -1, platformLoan: 101, agentLoan: NaN })
  assert.equal(r.agentRepay, DEFAULT_COMMISSION_RATES.agentRepay)
  assert.equal(r.platformLoan, DEFAULT_COMMISSION_RATES.platformLoan)
  assert.equal(r.agentLoan, DEFAULT_COMMISSION_RATES.agentLoan)
})

test('validateRates rejects a missing key, a negative and a value over 100', () => {
  const { agentLoan: _omit, ...missing } = DEFAULT_COMMISSION_RATES
  assert.equal(validateRates(missing).ok, false)
  assert.equal(validateRates({ ...DEFAULT_COMMISSION_RATES, agentRepay: -1 }).ok, false)
  assert.equal(validateRates({ ...DEFAULT_COMMISSION_RATES, platformLoan: 101 }).ok, false)
})

test('validateRates rejects savings rates that add up to more than 10', () => {
  assert.equal(validateRates({ ...DEFAULT_COMMISSION_RATES, agentSavings: 6, platformSavings: 5 }).ok, false)
})

test('validateRates accepts 0 and exactly 10 combined', () => {
  assert.equal(validateRates({ ...DEFAULT_COMMISSION_RATES, agentSavings: 0 }).ok, true)
  assert.equal(validateRates({ ...DEFAULT_COMMISSION_RATES, agentSavings: 4, platformSavings: 6 }).ok, true)
})

test('pct takes a percent of an amount and rounds to kobo', () => {
  assert.equal(pct(1000, 0.4), 4)
  assert.equal(pct(33.33, 1.5), 0.5)
})

test('validateRates caps the loan and repayment rates so a typo cannot pay out a loan\'s worth', () => {
  assert.equal(validateRates({ ...DEFAULT_COMMISSION_RATES, agentLoan: 11 }).ok, false)
  assert.equal(validateRates({ ...DEFAULT_COMMISSION_RATES, agentRepay: 11 }).ok, false)
  assert.equal(validateRates({ ...DEFAULT_COMMISSION_RATES, platformLoan: 51 }).ok, false)
  assert.equal(validateRates({ ...DEFAULT_COMMISSION_RATES, agentLoan: 10, agentRepay: 10, platformLoan: 50 }).ok, true)
})
