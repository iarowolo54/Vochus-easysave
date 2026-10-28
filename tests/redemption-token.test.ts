// Unit tests for redemption token hashing-at-rest.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { hashRedemptionToken, redemptionTokenMatches } from '../src/lib/redemption-token'

test('hash is the sha256 hex of the trimmed token', () => {
  const expected = createHash('sha256').update('123456').digest('hex')
  assert.equal(hashRedemptionToken('123456'), expected)
  assert.equal(hashRedemptionToken('  123456  '), expected) // trimmed
})

test('hash is 64 hex chars and not the plaintext', () => {
  const h = hashRedemptionToken('654321')
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.notEqual(h, '654321')
})

test('matches the stored hash for the right code', () => {
  const stored = hashRedemptionToken('246810')
  assert.equal(redemptionTokenMatches(stored, '246810'), true)
  assert.equal(redemptionTokenMatches(stored, ' 246810 '), true)
})

test('rejects the wrong code and a null/empty stored value', () => {
  const stored = hashRedemptionToken('246810')
  assert.equal(redemptionTokenMatches(stored, '000000'), false)
  assert.equal(redemptionTokenMatches(null, '246810'), false)
  assert.equal(redemptionTokenMatches('', '246810'), false)
})
