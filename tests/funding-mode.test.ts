// Unit test: the top-up method switch — bank transfer unless a channel is explicitly set to card AND Paystack is on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_FUNDING_MODE, effectiveFundingMode, parseFundingMode, validateFundingMode } from '../src/lib/funding-mode'

test('defaults to bank transfer for both; only an explicit "card" flips a channel', () => {
  assert.deepEqual(DEFAULT_FUNDING_MODE, { agent: 'transfer', customer: 'transfer' })
  assert.deepEqual(parseFundingMode(null), DEFAULT_FUNDING_MODE)
  assert.deepEqual(parseFundingMode('not json'), DEFAULT_FUNDING_MODE)
  assert.deepEqual(parseFundingMode('{"agent":"card","customer":"paystack"}'), { agent: 'card', customer: 'transfer' })
})

test('while Paystack is switched off, card is never in effect', () => {
  assert.deepEqual(effectiveFundingMode({ agent: 'card', customer: 'card' }, false), DEFAULT_FUNDING_MODE)
  assert.deepEqual(effectiveFundingMode({ agent: 'card', customer: 'transfer' }, true), { agent: 'card', customer: 'transfer' })
})

test('saving: both channels must be given; card is refused while Paystack is off', () => {
  assert.deepEqual(validateFundingMode({ agent: 'transfer', customer: 'card' }, true), { ok: true, mode: { agent: 'transfer', customer: 'card' } })
  assert.equal(validateFundingMode({ agent: 'card' }, true).ok, false)
  assert.equal(validateFundingMode({ agent: 'cash', customer: 'card' }, true).ok, false)
  const off = validateFundingMode({ agent: 'card', customer: 'transfer' }, false)
  assert.equal(off.ok, false)
  assert.match(off.ok ? '' : off.error, /Paystack is switched off/)
  assert.equal(validateFundingMode({ agent: 'transfer', customer: 'transfer' }, false).ok, true)
})
