import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refundSplit, refundNote, depositRefOf } from '../src/lib/fee-refund'
import { notifications } from '../src/lib/notifications'

test('refundSplit: the fee and each share come from the deposit’s own ledger rows', () => {
  assert.deepEqual(
    refundSplit([{ party: 'agent', source: 'daily_first', amount: 300 }, { party: 'platform', source: 'daily_first', amount: 200 }]),
    { fee: 500, agentShare: 300, platformShare: 200 },
  )
  assert.deepEqual(refundSplit([{ party: 'platform', source: 'periodic_fee', amount: 120 }]), { fee: 120, agentShare: 0, platformShare: 120 })
})

test('refundSplit: refuses a deposit with no fee, or one already refunded', () => {
  assert.throws(() => refundSplit([]), /NOT_REFUNDABLE/)
  assert.throws(() => refundSplit([{ party: 'agent', source: 'loan', amount: 50 }]), /NOT_REFUNDABLE/)
  assert.throws(() => refundSplit([
    { party: 'agent', source: 'daily_first', amount: 300 }, { party: 'platform', source: 'daily_first', amount: 200 },
    { party: 'agent', source: 'fee_refund', amount: -300 },
  ]), /ALREADY_REFUNDED/)
})

test('refundNote / depositRefOf: the refund names the deposit it undoes', () => {
  const note = refundNote('TXN-9809', 'Online customer; cash fee did not apply.')
  assert.equal(depositRefOf(note), 'TXN-9809')
  assert.equal(depositRefOf('Something else'), null)
  assert.equal(depositRefOf(null), null)
})

test('feeRefunded: tells the customer and the agent, keyed on the refund', () => {
  const ev = notifications.feeRefunded({ ref: 'FRF-1', customerId: 'c1', agentId: 'a1', customerName: 'lydia ojelade', planGoal: 'General Savings', fee: 500, agentShare: 300 })
  assert.equal(ev.length, 2)
  assert.equal(ev[0].recipient.type, 'customer')
  assert.equal(ev[0].kind, 'fee_refunded')
  assert.equal(ev[0].title, '₦500 platform fee refunded to General Savings')
  assert.equal(ev[0].dedupeKey, 'fee-refund:FRF-1')
  assert.equal(ev[1].recipient.type, 'agent')
  assert.equal(ev[1].kind, 'commission_returned')
  assert.equal(ev[1].title, '₦300 commission returned: Lydia Ojelade’s fee was refunded')
  assert.equal(ev[1].dedupeKey, 'fee-refund-agent:FRF-1')
})

test('feeRefunded: no agent notice when the agent had no share', () => {
  const ev = notifications.feeRefunded({ ref: 'FRF-2', customerId: 'c1', agentId: 'a1', customerName: 'x y', planGoal: 'G', fee: 120, agentShare: 0 })
  assert.equal(ev.length, 1)
})
