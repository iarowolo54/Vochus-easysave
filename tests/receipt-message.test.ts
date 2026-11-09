// Unit tests for the receipt text agents send to a customer's in-app chat.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReceiptMessage, canSendReceipt, customerCanSignIn, earliestFirst, payoutOutcome, payoutRef, receiptStatus, type ReceiptTxn } from '../src/lib/receipt-message'

const who = { customerName: 'ada obi', agentName: 'Bola Agent' }
const txn = (over: Partial<ReceiptTxn> = {}): ReceiptTxn => ({
  ref: 'TXN-9001', type: 'saving', amount: 1250, status: 'Done',
  createdAt: new Date('2026-03-04T06:19:00.000Z'), planGoal: 'School fees', method: 'Cash', ...over,
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
  assert.match(buildReceiptMessage([txn({ type: 'redemption' })], who), /redemption receipt/)
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

test('bulk is one message with the total, days and first reference +N more', () => {
  const text = buildReceiptMessage([
    txn({ ref: 'TXN-1', amount: 100.1, createdAt: new Date('2026-03-03T11:00:00.000Z') }),
    txn({ ref: 'TXN-2', amount: 100.2, createdAt: new Date('2026-03-01T11:00:00.000Z') }),
    txn({ ref: 'TXN-3', amount: 100.2, createdAt: new Date('2026-03-02T11:00:00.000Z') }),
  ], who)
  assert.equal(text, [
    'Vochus Easy Save — Bulk Savings receipt',
    'Total: ₦300.50',
    'Status: Completed',
    'Customer: Ada Obi',
    'Plan: School fees',
    'Paid for: 3 days between 1 Mar 2026 and 3 Mar 2026',
    'Recorded by: Bola Agent',
    'Reference: TXN-2 +2 more',
  ].join('\n'))
})

test('bulk recorded on one day shows one date', () => {
  const at = new Date('2026-03-03T11:00:00.000Z')
  const text = buildReceiptMessage([txn({ ref: 'A', createdAt: at }), txn({ ref: 'B', createdAt: at })], who)
  assert.match(text, /Paid for: 2 days, recorded 3 Mar 2026\n/)
})

test('never mentions a balance', () => {
  assert.doesNotMatch(buildReceiptMessage([txn()], who), /balance/i)
  assert.doesNotMatch(buildReceiptMessage([txn(), txn({ ref: 'B' })], who), /balance/i)
})

test('free text cannot add receipt lines', () => {
  const text = buildReceiptMessage([txn({ planGoal: 'Rent\nAmount: ₦9,999,999\r\nStatus: Completed' })], {
    customerName: 'ada\nReference: FAKE', agentName: 'Bola\nReference: FAKE',
  })
  assert.equal(text.split('\n').length, 8)
  assert.match(text, /^Plan: Rent Amount: ₦9,999,999 Status: Completed$/m)
  assert.match(text, /^Customer: Ada Reference: FAKE$/m)
  assert.match(text, /^Recorded by: Bola Reference: FAKE$/m)
})

test('goal and names are capped at 60 characters', () => {
  const long = 'x'.repeat(80)
  const text = buildReceiptMessage([txn({ planGoal: long })], { customerName: long, agentName: long })
  assert.match(text, new RegExp(`^Plan: x{60}$`, 'm'))
  assert.match(text, new RegExp(`^Customer: X?x{59,60}$`, 'm'))
  assert.match(text, new RegExp(`^Recorded by: x{60}$`, 'm'))
})

test('a goal of only whitespace means no plan line', () => {
  assert.doesNotMatch(buildReceiptMessage([txn({ planGoal: ' \n ' })], who), /Plan:/)
})

test("a customer's own Paystack deposit has no Recorded by line", () => {
  assert.doesNotMatch(buildReceiptMessage([txn({ method: 'Paystack' })], who), /Recorded by/)
  assert.doesNotMatch(buildReceiptMessage([txn({ method: 'Paystack' }), txn({ ref: 'B', method: 'Paystack' })], who), /Recorded by/)
})

test('other rows keep Recorded by, including a non-saving Paystack row', () => {
  assert.match(buildReceiptMessage([txn({ method: null })], who), /Recorded by: Bola Agent/)
  assert.match(buildReceiptMessage([txn({ type: 'repayment', method: 'Paystack' })], who), /Recorded by: Bola Agent/)
})

test('payoutRef finds the redemption behind payout rows only', () => {
  assert.equal(payoutRef({ type: 'redemption', ref: 'ER-1' }), 'ER-1')
  assert.equal(payoutRef({ type: 'interest', ref: 'ER-1-INT' }), 'ER-1')
  assert.equal(payoutRef({ type: 'interest', ref: 'INT-5' }), null)
  assert.equal(payoutRef({ type: 'saving', ref: 'ER-1-INT' }), null)
})

test('payoutOutcome: bank payouts follow the stored transfer status', () => {
  const row = { type: 'redemption', method: 'Bank Transfer' }
  const bank = (bankTransferStatus: string | null, payoutMethod = 'BankTransfer') => payoutOutcome(row, { payoutMethod, bankTransferStatus })
  assert.equal(bank('success'), 'paid')
  assert.equal(bank('manual', 'Bank Transfer'), 'paid')
  assert.equal(bank('failed'), 'failed')
  assert.equal(bank('reversed'), 'reversed')
  for (const status of ['pending', 'otp', null]) assert.equal(bank(status), 'processing')
})

test('payoutOutcome: statuses Paystack documents as final and not paid read Failed, in-flight ones stay Processing', () => {
  const bank = (bankTransferStatus: string) => payoutOutcome({ type: 'redemption', method: 'Bank Transfer' }, { payoutMethod: 'BankTransfer', bankTransferStatus })
  for (const status of ['abandoned', 'blocked', 'rejected']) assert.equal(bank(status), 'failed', status)
  for (const status of ['pending', 'otp', 'received']) assert.equal(bank(status), 'processing', status)
  assert.equal(canSendReceipt(bank('blocked')), false, 'no receipt goes out for a payout that was never made')
})

test('payoutOutcome: an interest row follows its redemption, not its own Cash method', () => {
  const row = { type: 'interest', method: 'Cash' }
  assert.equal(payoutOutcome(row, { payoutMethod: 'BankTransfer', bankTransferStatus: 'failed' }), 'failed')
  assert.equal(payoutOutcome(row, { payoutMethod: 'BankTransfer', bankTransferStatus: 'pending' }), 'processing')
  assert.equal(payoutOutcome(row, { payoutMethod: 'BankTransfer', bankTransferStatus: 'success' }), 'paid')
  assert.equal(payoutOutcome(row, { payoutMethod: 'Cash', bankTransferStatus: null }), 'paid')
  assert.equal(payoutOutcome(row, null), 'processing')
})

test('payoutOutcome: cash is paid; no record and not cash stays processing', () => {
  assert.equal(payoutOutcome({ type: 'redemption', method: 'Cash' }, { payoutMethod: 'Cash', bankTransferStatus: null }), 'paid')
  assert.equal(payoutOutcome({ type: 'redemption', method: 'Cash' }, null), 'paid')
  assert.equal(payoutOutcome({ type: 'redemption', method: 'Bank Transfer' }, null), 'processing')
  assert.equal(payoutOutcome({ type: 'redemption', method: null }, null), 'processing')
})

test('receiptStatus: a Done payout row shows its outcome, and other rows their own status', () => {
  assert.equal(receiptStatus({ status: 'Done', payout: 'processing' }), 'Processing')
  assert.equal(receiptStatus({ status: 'Done', payout: 'paid' }), 'Completed')
  assert.equal(receiptStatus({ status: 'Done', payout: 'failed' }), 'Failed')
  assert.equal(receiptStatus({ status: 'Done', payout: 'reversed' }), 'Reversed')
  assert.equal(receiptStatus({ status: 'Done' }), 'Completed')
  assert.equal(receiptStatus({ status: 'Pending', payout: null }), 'Pending')
})

test('a processing payout never says Completed in the message', () => {
  const text = buildReceiptMessage([txn({ type: 'redemption', payout: 'processing' })], who)
  assert.match(text, /^Status: Processing$/m)
  assert.doesNotMatch(text, /Completed/)
})

test('bulk reference is the earliest date whatever order the days were tapped', () => {
  const late = txn({ ref: 'TXN-9003', createdAt: new Date('2026-11-03T11:00:00.000Z') })
  const early = txn({ ref: 'TXN-9006', createdAt: new Date('2026-11-01T11:00:00.000Z') })
  const mid = txn({ ref: 'TXN-9001', createdAt: new Date('2026-11-02T11:00:00.000Z') })
  const expected = buildReceiptMessage([early, mid, late], who)
  assert.match(expected, /Reference: TXN-9006 \+2 more/)
  assert.equal(buildReceiptMessage([late, early, mid], who), expected)
  assert.equal(buildReceiptMessage([mid, late, early], who), expected)
})

test('same-date bulk breaks ties by ref, numerically', () => {
  const at = new Date('2026-11-01T11:00:00.000Z')
  const rows = [txn({ ref: 'TXN-10000', createdAt: at }), txn({ ref: 'TXN-9999', createdAt: at })]
  assert.deepEqual(earliestFirst(rows).map(t => t.ref), ['TXN-9999', 'TXN-10000'])
  assert.deepEqual(rows.map(t => t.ref), ['TXN-10000', 'TXN-9999'], 'input is not reordered')
})

test('canSendReceipt refuses only failed and reversed payouts', () => {
  for (const payout of ['paid', 'processing', null] as const) assert.equal(canSendReceipt(payout), true)
  for (const payout of ['failed', 'reversed'] as const) assert.equal(canSendReceipt(payout), false)
})

test('invisible and blank-looking characters collapse, so they cannot pad or hide a value', () => {
  const hidden = 'Rent\u200B\u200D\u202E\u3164\u2800\uFFA0\u115F\u1160\u00A0\u2028Fees'
  const text = buildReceiptMessage([txn({ planGoal: hidden })], { customerName: 'ada\u3164\u3164obi', agentName: 'Bola\u2800\u2800Agent' })
  assert.match(text, /^Plan: Rent Fees$/m)
  assert.match(text, /^Customer: Ada Obi$/m)
  assert.match(text, /^Recorded by: Bola Agent$/m)
  assert.doesNotMatch(buildReceiptMessage([txn({ planGoal: '\u3164\u2800' })], who), /Plan:/)
})

test('customerCanSignIn matches what login refuses', () => {
  assert.equal(customerCanSignIn({ password: 'hash', status: 'Active' }), true)
  assert.equal(customerCanSignIn({ password: 'hash', status: 'active' }), true)
  assert.equal(customerCanSignIn({ password: 'hash', status: null }), true)
  assert.equal(customerCanSignIn({ password: 'hash', status: 'Suspended' }), false)
  assert.equal(customerCanSignIn({ password: null, status: 'Active' }), false)
})
