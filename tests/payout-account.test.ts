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

test('accents are ignored, whichever side has them', () => {
  assert.equal(accountNameMatches('ADEBAYO OBI', { firstName: 'Adébáyọ̀', lastName: 'Obi' }), true)
  assert.equal(accountNameMatches('Adébáyọ̀ Obi', { firstName: 'Adebayo', lastName: 'Obi' }), true)
  assert.equal(accountNameMatches('NWÁNYỊ̀ ÌBÀDÀN', { firstName: 'nwanyi', lastName: 'ibadan' }), true)
})

test('both parts of the name are required', () => {
  assert.equal(accountNameMatches('ADA OBI', { firstName: 'Ada', lastName: '' }), false)
  assert.equal(accountNameMatches('ADA OBI', { firstName: '', lastName: 'Obi' }), false)
  assert.equal(accountNameMatches('ADA OBI', { firstName: "'", lastName: 'Obi' }), false)
})

test('a business or joint account is refused even with the customer\'s name in it', () => {
  for (const name of ['ADA OBI VENTURES', 'ADA OBI LTD', 'OBI ADA ENTERPRISES', 'ADA OBI GLOBAL RESOURCES', 'ADA AND OBI', 'ADA OBI LIMITED']) {
    assert.equal(accountNameMatches(name, ada), false, name)
  }
  assert.equal(accountNameMatches('ADA OBI GLOBAL', ada), true, 'global alone can be a name')
})
