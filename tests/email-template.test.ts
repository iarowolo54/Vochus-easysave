// Unit test: the shared payout email layout escapes what it is given and shows only the rows that have a value.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderEmail, type EmailContent } from '../src/lib/email-template'

const base: EmailContent = {
  subject: 'Your redemption has been paid',
  preheader: '₦1,000.00 has been paid to you',
  tone: 'success',
  statusLabel: 'Paid',
  heading: 'Your redemption is paid',
  intro: 'Details below.',
  amount: '₦1,000.00',
  amountLabel: 'Amount paid to you',
  rows: [['Plan', 'Shop stock'], ['Fee taken', null], ['Paid to', ''], ['Reference', 'RDM-1']],
}

test('shows the amount, status and each row that has a value', () => {
  const html = renderEmail(base)
  for (const text of ['₦1,000.00', 'Paid', 'Shop stock', 'RDM-1', 'Amount paid to you']) assert.ok(html.includes(text), text)
})

test('drops rows with no value', () => {
  const html = renderEmail(base)
  assert.ok(!html.includes('Fee taken'))
  assert.ok(!html.includes('Paid to<'))
})

test('escapes text from outside, such as a decline reason', () => {
  const html = renderEmail({ ...base, rows: [['Reason', '<script>alert(1)</script>']] })
  assert.ok(!html.includes('<script>alert'))
  assert.ok(html.includes('&#60;script&#62;'))
})
