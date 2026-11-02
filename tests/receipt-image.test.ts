// The saved receipt image is shared with the customer's own receipt, so a Completed one must not change.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { showsProofOfPayment, statusPillColors } from '../src/lib/receipt-image'

test('only a completed payment calls itself proof of payment', () => {
  assert.equal(showsProofOfPayment('Completed'), true)
  for (const status of ['Processing', 'Pending', 'Failed', 'Reversed', 'Rejected']) assert.equal(showsProofOfPayment(status), false, status)
})

test('the pill is green only when completed, with the same green as before', () => {
  assert.deepEqual(statusPillColors('Completed'), { background: '#e7f3ea', ink: '#146c34' })
  const waiting = statusPillColors('Processing')
  assert.deepEqual(statusPillColors('Pending'), waiting)
  assert.notEqual(waiting.background, statusPillColors('Completed').background)
  const failed = statusPillColors('Failed')
  assert.deepEqual(statusPillColors('Reversed'), failed)
  assert.notEqual(failed.background, waiting.background)
})
