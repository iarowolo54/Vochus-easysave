import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardLinkBlockReason } from '../src/lib/member-card'
import { genTxnRef } from '../src/lib/ref'

const future = new Date(Date.now() + 365 * 86400_000)
const past = new Date(Date.now() - 86400_000)

test('cardLinkBlockReason: an Unlinked, unexpired card is linkable (#16)', () => {
  assert.equal(cardLinkBlockReason({ status: 'Unlinked', expiryDate: future }), null)
})

test('cardLinkBlockReason: already linked', () => {
  assert.equal(cardLinkBlockReason({ status: 'Linked', expiryDate: future }), 'linked')
})

test('cardLinkBlockReason: blocked card is refused', () => {
  assert.equal(cardLinkBlockReason({ status: 'Blocked', expiryDate: future }), 'blocked')
})

test('cardLinkBlockReason: expired card is refused', () => {
  assert.equal(cardLinkBlockReason({ status: 'Unlinked', expiryDate: past }), 'expired')
})

test('genTxnRef: prefixed, unique-ish, no collision across many calls (#17)', () => {
  const r = genTxnRef('ENR')
  assert.match(r, /^ENR-[0-9A-F]+$/)
  const seen = new Set(Array.from({ length: 5000 }, () => genTxnRef('ENR')))
  assert.equal(seen.size, 5000, 'refs must not collide')
})
