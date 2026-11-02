// Whether a bank account is the customer's own, and what the customer is told about it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountNameMatches, payoutDestination } from '../src/lib/payout-account'

const ada = { firstName: 'Ada', lastName: 'Obi' }

test('tolerates case, order, extra names and punctuation', () => {
  for (const name of ['ADA OBI', 'OBI ADA', 'OBI ADA CHIOMA', 'Obi, Ada C.']) assert.equal(accountNameMatches(name, ada), true, name)
  assert.equal(accountNameMatches("JOHN O'NEIL", { firstName: 'John', lastName: 'O’Neil' }), true)
  assert.equal(accountNameMatches('ANN MARIE OBI', { firstName: 'Ann-Marie', lastName: 'Obi' }), true)
})

test('refuses another person, half a name, a short form or an initial', () => {
  for (const name of ['SOME AGENT', 'ADA', 'OBI', 'ADAEZE OBI', 'A OBI', '']) assert.equal(accountNameMatches(name, ada), false, name)
  assert.equal(accountNameMatches('OLUWASEUN ADE', { firstName: 'Seun', lastName: 'Ade' }), false)
  assert.equal(accountNameMatches('ANYONE', { firstName: ' ', lastName: ' ' }), false)
})

test('the customer is told the bank and last four digits only', () => {
  assert.equal(payoutDestination('GTBank', '0123456789'), 'Payout goes to GTBank account ending 6789.')
})
