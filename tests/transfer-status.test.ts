//   npx tsx --test tests/transfer-status.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { intentStatus, alertStatus } from '../src/lib/transfer-status'
import { TRANSFER_GRACE_MS } from '../src/lib/transfer-intent'

const now = Date.parse('2026-11-05T10:00:00Z')
const at = (ms: number) => new Date(now + ms)

test('pending inside the window or grace is waiting', () => {
  assert.equal(intentStatus({ status: 'Pending', expiresAt: at(60_000), manualBy: null }, now), 'waiting')
  assert.equal(intentStatus({ status: 'Pending', expiresAt: at(-TRANSFER_GRACE_MS + 1), manualBy: null }, now), 'waiting')
})

test('pending past the grace is not paid', () => {
  assert.equal(intentStatus({ status: 'Pending', expiresAt: at(-TRANSFER_GRACE_MS - 1), manualBy: null }, now), 'not-paid')
  assert.equal(intentStatus({ status: 'Pending', expiresAt: null, manualBy: null }, now), 'not-paid')
})

test('done is paid, or credited by hand when staff did it', () => {
  assert.equal(intentStatus({ status: 'Done', expiresAt: at(0), manualBy: null }, now), 'paid')
  assert.equal(intentStatus({ status: 'Done', expiresAt: at(0), manualBy: 'Sam' }, now), 'by-hand')
})

test('review is needs review', () => {
  assert.equal(intentStatus({ status: 'Review', expiresAt: at(0), manualBy: null }, now), 'needs-review')
})

test('held alerts map to the same words', () => {
  assert.equal(alertStatus({ status: 'Unmatched' }), 'needs-review')
  assert.equal(alertStatus({ status: 'Resolved' }), 'by-hand')
  assert.equal(alertStatus({ status: 'Dismissed' }), 'dismissed')
})

test('a cancelled request shows as cancelled, whatever its window says', () => {
  assert.equal(intentStatus({ status: 'Cancelled', expiresAt: at(60_000), manualBy: null }, now), 'cancelled')
  assert.equal(intentStatus({ status: 'Cancelled', expiresAt: at(-TRANSFER_GRACE_MS * 5), manualBy: null }, now), 'cancelled')
})
