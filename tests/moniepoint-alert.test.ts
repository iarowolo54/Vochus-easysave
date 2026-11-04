//   npx tsx --test tests/moniepoint-alert.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMoniepointAlert, isAuthenticAlert } from '../src/lib/moniepoint-alert'

const BODY = `Hi OLUSAKIN, We wish to inform you that a credit transaction occurred on your account with us.
Log in to Business Banking for more details.
------------------------------
Credit Amount
13,000.00
------------------------------
Transaction Details
Account Balance: N 17,947.00
------------------------------
Account Number: 6801958686
------------------------------
Sender's Name: from AROWOLO OLUSAKIN ISAIAH
------------------------------
Date & Time: 02 Nov, 2026 | 07:52:45 PM
------------------------------
Narration: MOB/UTO/ZIPWAVES TECHN/payment/38476235933|AROWOLO OLUSAKIN ISAIAH
------------------------------`

test('parses the real sample', () => {
  const a = parseMoniepointAlert(BODY)
  assert.ok(a)
  assert.equal(a.amount, 13000)
  assert.equal(a.senderName, 'AROWOLO OLUSAKIN ISAIAH')
  assert.equal(a.txnId, '38476235933')
  assert.equal(a.at.toISOString(), '2026-11-02T18:52:45.000Z')
})

test('a duplicated body (plain + html) parses the same single alert', () => {
  const a = parseMoniepointAlert(BODY + '\n' + BODY)
  assert.equal(a?.amount, 13000)
})

test('parses html-wrapped text and kobo amounts', () => {
  const html = `<html><body><p>Credit Amount</p><p><b>1,250.37</b></p><p>Date &amp; Time: 03 Nov, 2026 | 12:05:09 AM</p><p>Narration: MOB/X/payment/9988776655|JANE DOE</p><p>Sender's Name: from JANE DOE</p></body></html>`
  const a = parseMoniepointAlert(html)
  assert.equal(a?.amount, 1250.37)
  assert.equal(a?.txnId, '9988776655')
  assert.equal(a?.at.toISOString(), '2026-11-02T23:05:09.000Z')
})

const SETTLEMENT = (amount: string, balance: string, time: string) => `Credit Amount ${amount} Transaction Details Account Balance: N ${balance} Account Number: 6801958686 Sender's Name: from Paystack Date & Time: ${time} Narration: TRF FRM PAYSTACK If you experience any problems kindly contact us`

test('a narration with no bank number still gets a stable, distinct id', () => {
  const a = parseMoniepointAlert(SETTLEMENT('7,484.50', '83,711.00', '28 Oct, 2026 | 08:13:20 AM'))
  const again = parseMoniepointAlert(SETTLEMENT('7,484.50', '83,711.00', '28 Oct, 2026 | 08:13:20 AM'))
  const b = parseMoniepointAlert(SETTLEMENT('1,379.00', '85,090.00', '29 Oct, 2026 | 09:13:51 AM'))
  assert.ok(a && again && b)
  assert.equal(a.senderName, 'Paystack')
  assert.match(a.txnId, /^h[0-9a-f]{24}$/)
  assert.equal(a.txnId, again.txnId)
  assert.notEqual(a.txnId, b.txnId)
})

test('same amount and time but a different balance gives a different id', () => {
  const x = parseMoniepointAlert(SETTLEMENT('500.00', '1,000.00', '03 Nov, 2026 | 10:00:00 AM'))
  const y = parseMoniepointAlert(SETTLEMENT('500.00', '1,500.00', '03 Nov, 2026 | 10:00:00 AM'))
  assert.notEqual(x?.txnId, y?.txnId)
})

test('text that is not a credit alert is null', () => {
  assert.equal(parseMoniepointAlert('Your statement is ready'), null)
  assert.equal(parseMoniepointAlert('Credit Amount\nabc'), null)
})

const OK = 'mx.google.com; dkim=pass header.i=@moniepoint.com; spf=pass smtp.mailfrom=moniepoint.com; dmarc=pass header.from=moniepoint.com'
const SENDER = 'alerts@moniepoint.com'

test('authentic: one right From address, Gmail says dkim and dmarc pass', () => {
  assert.equal(isAuthenticAlert([SENDER], [OK], SENDER), true)
})

test('wrong, lookalike or multiple From addresses are rejected', () => {
  assert.equal(isAuthenticAlert(['alerts@moniepoint.com.evil.io'], [OK], SENDER), false)
  assert.equal(isAuthenticAlert(['x@evil.io'], [OK], SENDER), false)
  assert.equal(isAuthenticAlert([SENDER, 'x@evil.io'], [OK], SENDER), false)
  assert.equal(isAuthenticAlert([], [OK], SENDER), false)
})

test('no dkim pass, or a failing dmarc, is rejected', () => {
  assert.equal(isAuthenticAlert([SENDER], ['mx.google.com; spf=pass; dmarc=pass header.from=moniepoint.com'], SENDER), false)
  assert.equal(isAuthenticAlert([SENDER], ['mx.google.com; dkim=pass header.i=@moniepoint.com; dmarc=fail header.from=moniepoint.com'], SENDER), false)
  assert.equal(isAuthenticAlert([SENDER], [], SENDER), false)
})

test('dkim signed by an unrelated domain is rejected', () => {
  assert.equal(isAuthenticAlert([SENDER], ['mx.google.com; dkim=pass header.i=@evil.io; dmarc=pass header.from=moniepoint.com'], SENDER), false)
})

test('a forged Authentication-Results below Gmail’s own header is ignored', () => {
  const gmailSaysFail = 'mx.google.com; dkim=fail header.i=@moniepoint.com; dmarc=fail header.from=moniepoint.com'
  assert.equal(isAuthenticAlert([SENDER], [gmailSaysFail, OK], SENDER), false)
})

test('a top header from another server is not trusted', () => {
  assert.equal(isAuthenticAlert([SENDER], [OK.replace('mx.google.com', 'mx.evil.io')], SENDER), false)
})
