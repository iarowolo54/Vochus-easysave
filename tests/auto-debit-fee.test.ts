import { test } from 'node:test'
import assert from 'node:assert/strict'
import { money } from '../src/lib/wallet-guard'
import { paystackFee, grossUpForFee } from '../src/lib/auto-debit-fee'

test('paystackFee: 1.5%, +100 from 2500, capped at 2000', () => {
  assert.equal(paystackFee(100), 1.5)
  assert.equal(paystackFee(1000), 15)
  assert.equal(paystackFee(2500), 137.5)
  assert.equal(paystackFee(200000), 2000)
})

test('grossUpForFee: simple credit', () => {
  const { grossCharged, feeEstimate } = grossUpForFee(1000)
  assert.equal(grossCharged, 1015.23)
  assert.ok(money(grossCharged - feeEstimate) >= 1000)
})

test('grossUpForFee: crossing the 2500 flat-fee band', () => {
  const { grossCharged, feeEstimate } = grossUpForFee(2490)
  assert.ok(grossCharged >= 2500)
  assert.equal(feeEstimate, paystackFee(grossCharged))
  assert.ok(money(grossCharged - paystackFee(grossCharged)) >= 2490)
})

test('grossUpForFee: small credit', () => {
  const { grossCharged, feeEstimate } = grossUpForFee(100)
  assert.ok(money(grossCharged - feeEstimate) >= 100)
})
