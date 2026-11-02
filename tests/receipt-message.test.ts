// Unit tests for the receipt text agents send to a customer's in-app chat.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReceiptMessage, type ReceiptTxn } from '../src/lib/receipt-message'

const who = { customerName: 'ada obi', agentName: 'Bola Agent' }
const txn = (over: Partial<ReceiptTxn> = {}): ReceiptTxn => ({
  ref: 'TXN-9001', type: 'saving', amount: 1250, status: 'Done',
  createdAt: new Date('2026-03-04T06:19:00.000Z'), planGoal: 'School fees', ...over,
})

test('single receipt has every field, one per line, in order', () => {
  assert.equal(buildReceiptMessage([txn()], who), [
    'Vochus Easy Save — savings deposit receipt',
    'Amount: ₦1,250.00',
    'Status: Completed',
    'Customer: Ada Obi',
    'Plan: School fees',
    'Date: 4 Mar 2026, 7:19 am',
    'Recorded by: Bola Agent',
    'Reference: TXN-9001',
  ].join('\n'))
})

test('date is Lagos time whatever the server timezone: 23:30 UTC is the next morning', () => {
  const text = buildReceiptMessage([txn({ createdAt: new Date('2026-03-04T23:30:00.000Z') })], who)
  assert.match(text, /Date: 5 Mar 2026, 12:30 am/)
})

test('enrolment hides the amount, as the receipt page does', () => {
  const text = buildReceiptMessage([txn({ type: 'enrolment', amount: 500 })], who)
  assert.doesNotMatch(text, /Amount|₦/)
  assert.match(text, /enrolment receipt/)
})

test('titles are worded for the customer, not the agent', () => {
  assert.match(buildReceiptMessage([txn({ type: 'disbursement' })], who), /loan received receipt/)
  assert.match(buildReceiptMessage([txn({ type: 'redemption' })], who), /collection receipt/)
  assert.match(buildReceiptMessage([txn({ type: 'some_new_type' })], who), /some new type receipt/)
})

test('status follows the receipt page wording', () => {
  assert.match(buildReceiptMessage([txn({ status: 'Pending' })], who), /Status: Pending/)
  assert.match(buildReceiptMessage([txn({ status: 'Failed' })], who), /Status: Failed/)
})

test('no plan means no plan line', () => {
  assert.doesNotMatch(buildReceiptMessage([txn({ planGoal: null })], who), /Plan:/)
  assert.doesNotMatch(buildReceiptMessage([txn({ planGoal: '' })], who), /Plan:/)
})

test('bulk is one message with the total, day count and first reference +N more', () => {
  const text = buildReceiptMessage([
    txn({ ref: 'TXN-1', amount: 100.1, createdAt: new Date('2026-03-03T11:00:00.000Z') }),
    txn({ ref: 'TXN-2', amount: 100.2, createdAt: new Date('2026-03-01T11:00:00.000Z') }),
    txn({ ref: 'TXN-3', amount: 100.2, createdAt: new Date('2026-03-02T11:00:00.000Z') }),
  ], who)
  assert.equal(text, [
    'Vochus Easy Save — Bulk Savings receipt',
    'Total: ₦300.50',
    'Days: 3',
    'Status: Completed',
    'Customer: Ada Obi',
    'Plan: School fees',
    'Dates: 1 Mar 2026 to 3 Mar 2026',
    'Recorded by: Bola Agent',
    'Reference: TXN-1 +2 more',
  ].join('\n'))
})

test('bulk recorded on one day shows one date', () => {
  const at = new Date('2026-03-03T11:00:00.000Z')
  const text = buildReceiptMessage([txn({ ref: 'A', createdAt: at }), txn({ ref: 'B', createdAt: at })], who)
  assert.match(text, /Dates: 3 Mar 2026\n/)
})

test('never mentions a balance', () => {
  assert.doesNotMatch(buildReceiptMessage([txn()], who), /balance/i)
  assert.doesNotMatch(buildReceiptMessage([txn(), txn({ ref: 'B' })], who), /balance/i)
})
