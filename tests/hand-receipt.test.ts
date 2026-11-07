import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HAND_CREDIT_NOTE, isHandCredit, methodText, handReceiptSms, wantsHandReceiptSms, receiptHref,
} from '../src/lib/hand-receipt'

test('a deposit staff credited by hand is recognised from its stored note', () => {
  assert.equal(isHandCredit(HAND_CREDIT_NOTE), true)
  assert.equal(isHandCredit('Customer self-pay via Moniepoint transfer — bank_transfer'), false)
  assert.equal(isHandCredit(null), false)
})

test('receipt method: a bank transfer never carries the agent name; a hand credit says staff confirmed it', () => {
  assert.equal(methodText({ method: 'Transfer', recordedBy: 'Ade Agent' }), 'Bank transfer')
  assert.equal(methodText({ method: 'Transfer', recordedBy: 'Ade Agent', confirmedByStaff: true }), 'Bank transfer, confirmed by Vochus staff')
  assert.equal(methodText({ method: 'Cash', recordedBy: 'Ade Agent' }), 'Cash, collected by Ade Agent')
  assert.equal(methodText({ method: null }), 'Cash')
  assert.equal(methodText({ method: 'Paystack' }), 'Card or bank transfer')
  assert.equal(methodText({ method: 'Bulk', recordedBy: 'Ade Agent' }), 'Bulk, recorded by Ade Agent')
})

test('SMS receipt goes only for a hand-approved deposit into a cash (agent-opened) plan', () => {
  assert.equal(wantsHandReceiptSms({ via: 'Staff by hand', planSource: 'agent' }), true)
  assert.equal(wantsHandReceiptSms({ via: 'Staff by hand', planSource: null }), true)
  assert.equal(wantsHandReceiptSms({ via: 'Staff by hand', planSource: 'self' }), false)
  assert.equal(wantsHandReceiptSms({ via: 'Moniepoint transfer', planSource: 'agent' }), false)
  assert.equal(wantsHandReceiptSms({ via: 'Paystack', planSource: 'agent' }), false)
})

test('SMS receipt text: plain ASCII (NGN, no naira sign), amount, plan, balance, reference', () => {
  const text = handReceiptSms({ name: 'Oluwaseun', amount: 2000, goal: 'Business', balanceAfter: 12500.5, reference: 'VCHS-MAN-1730900000000-ABCDEFG' })
  assert.equal(text,
    'Vochus Easy Save: Hi Oluwaseun, we received your bank transfer of NGN 2,000 and saved it to Business. Balance NGN 12,500.50. Ref VCHS-MAN-1730900000000-ABCDEFG')
  assert.match(text, /^[\x20-\x7E]+$/, 'only plain characters, so it stays a normal-rate SMS')
})

test('SMS receipt text without a known balance leaves the balance out', () => {
  const text = handReceiptSms({ name: 'Ola', amount: 500, goal: '', balanceAfter: null, reference: 'R1' })
  assert.equal(text, 'Vochus Easy Save: Hi Ola, we received your bank transfer of NGN 500 and saved it to your savings plan. Ref R1')
})

test('the savings notice opens that deposit\'s receipt in History', () => {
  assert.equal(receiptHref('VCHS-MAN-1-AB_c'), '/customer/transactions?ref=VCHS-MAN-1-AB_c')
  assert.equal(receiptHref('a b&c'), '/customer/transactions?ref=a%20b%26c')
})

test('the payment email says staff confirmed a hand-approved deposit, and only then', async () => {
  const { paymentAlertEmail } = await import('../src/lib/payment-alert')
  const base = { kind: 'saving' as const, email: 'a@example.test', name: 'Ola', amount: 2000, reference: 'R1', destination: 'Business', balanceAfter: 12000 }
  assert.match(paymentAlertEmail({ ...base, via: 'Staff by hand' }).html, /Confirmed by[\s\S]*Vochus staff/)
  assert.doesNotMatch(paymentAlertEmail({ ...base, via: 'Moniepoint transfer' }).html, /Confirmed by/)
})
