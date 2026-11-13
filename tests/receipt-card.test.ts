// Unit tests: the receipt picture's facts in the chat (built from server records) and the check that reads them back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReceiptCard, buildReceiptMessage, type ReceiptTxn } from '../src/lib/receipt-message'
import { parseReceiptCard } from '../src/lib/receipt-card'

const who = { customerName: 'ada obi', agentName: 'Bola Agent' }
const txn = (over: Partial<ReceiptTxn> = {}): ReceiptTxn => ({
  ref: 'TXN-9001', type: 'saving', amount: 1250, status: 'Done',
  createdAt: new Date('2026-03-04T06:19:00.000Z'), planGoal: 'School fees', method: 'Cash', ...over,
})

test('a single receipt carries the same facts as the text', () => {
  assert.deepEqual(buildReceiptCard([txn()], who), {
    title: 'Savings deposit', amount: '₦1,250.00', status: 'Completed', reference: 'TXN-9001',
    rows: [['Date', '4 Mar 2026, 7:19 am'], ['Customer', 'Ada Obi'], ['Plan', 'School fees'], ['Recorded by', 'Bola Agent']],
  })
})

test('a Bulk Savings payment is one receipt with the total and the days', () => {
  const days = [1, 2, 3].map(d => txn({ ref: `TXN-${d}`, amount: 100, createdAt: new Date(`2026-03-0${d}T09:00:00.000Z`) }))
  const card = buildReceiptCard([days[2], days[0], days[1]], who)
  assert.equal(card.title, 'Bulk Savings')
  assert.equal(card.amount, '₦300.00')
  assert.equal(card.reference, 'TXN-1 +2 more')
  assert.deepEqual(card.rows[0], ['Paid for', '3 days between 1 Mar 2026 and 3 Mar 2026'])
  // Same facts as the text version.
  const text = buildReceiptMessage(days, who)
  assert.match(text, /Total: ₦300\.00/)
})

test('enrolment has no amount; a customer’s own card payment has no “Recorded by”', () => {
  assert.equal(buildReceiptCard([txn({ type: 'enrolment' })], who).amount, '—')
  const self = buildReceiptCard([txn({ method: 'Paystack' })], who)
  assert.equal(self.rows.some(([k]) => k === 'Recorded by'), false)
})

test('free text cannot add fake lines to the picture', () => {
  const card = buildReceiptCard([txn({ planGoal: 'Rent\nAmount: ₦1,000,000' })], { customerName: 'Ada​Obi', agentName: 'Bola\nAgent' })
  for (const [, v] of card.rows) assert.equal(/\n/.test(v), false, v)
})

test('a stored receipt reads back exactly', () => {
  const card = buildReceiptCard([txn()], who)
  assert.deepEqual(parseReceiptCard(JSON.stringify(card)), card)
})

test('anything else is not drawn as a receipt', () => {
  const good = buildReceiptCard([txn()], who)
  const bad = [
    null, undefined, '', 'not json', '5', '[]', JSON.stringify({}),
    JSON.stringify({ ...good, amount: 5 }),
    JSON.stringify({ ...good, rows: [['only one']] }),
    JSON.stringify({ ...good, rows: Array(9).fill(['a', 'b']) }),
    JSON.stringify({ ...good, title: 'x'.repeat(201) }),
    JSON.stringify({ ...good, reference: '' }),
  ]
  for (const b of bad) assert.equal(parseReceiptCard(b), null, String(b))
})
