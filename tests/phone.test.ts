import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhone } from '../src/lib/phone'

test('keeps canonical 0-form unchanged', () => {
  assert.equal(normalizePhone('08012345678'), '08012345678')
})
test('folds +234 to 0', () => {
  assert.equal(normalizePhone('+2348012345678'), '08012345678')
})
test('folds 13-digit 234 to 0', () => {
  assert.equal(normalizePhone('2348012345678'), '08012345678')
})
test('strips spaces and dashes', () => {
  assert.equal(normalizePhone(' 0801-234 5678 '), '08012345678')
})
test('does not fold a 234-prefixed local number of wrong length', () => {
  assert.equal(normalizePhone('2340'), '2340')
})
