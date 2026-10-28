// Unit tests for the server-side loan-request eligibility rules
// (UI-agent finding: the 80%-of-savings cap and the one-active-loan rule
// were enforced ONLY in the page, never in POST /api/loans).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LOAN_LIMIT_FRACTION, checkLoanEligibility } from '../src/lib/loan-eligibility'

test('the cap is 80% of savings', () => {
  assert.equal(LOAN_LIMIT_FRACTION, 0.8)
})

test('principal within 80% of savings is allowed', () => {
  const r = checkLoanEligibility({ principal: 800, savingsBalance: 1000, hasActiveLoan: false })
  assert.equal(r.ok, true)
})

test('principal exactly at 80% of savings is allowed', () => {
  const r = checkLoanEligibility({ principal: 800, savingsBalance: 1000, hasActiveLoan: false })
  assert.equal(r.ok, true)
})

test('principal above 80% of savings is rejected', () => {
  const r = checkLoanEligibility({ principal: 801, savingsBalance: 1000, hasActiveLoan: false })
  assert.equal(r.ok, false)
  assert.match(r.error!, /80%/)
})

test('a customer with no savings cannot borrow', () => {
  const r = checkLoanEligibility({ principal: 1, savingsBalance: 0, hasActiveLoan: false })
  assert.equal(r.ok, false)
})

test('a customer with an active loan is rejected even within the cap', () => {
  const r = checkLoanEligibility({ principal: 10, savingsBalance: 1000, hasActiveLoan: true })
  assert.equal(r.ok, false)
  assert.match(r.error!, /loan/i)
})

test('the active-loan rule is checked before the amount', () => {
  // over-cap AND has a loan -> the loan message wins (clearer next step for the agent)
  const r = checkLoanEligibility({ principal: 999999, savingsBalance: 1000, hasActiveLoan: true })
  assert.equal(r.ok, false)
  assert.match(r.error!, /already has a loan/i)
})
