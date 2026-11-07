// Unit test: where a rollover / save-again code goes. Online customers: email first (if confirmed), SMS as backup.
// Cash customers: always SMS (they are with their agent); email only if the text can't be sent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codeChannels } from '../src/lib/plan-reopen-code'

test('online customer with a confirmed email: email first, then SMS', () => {
  assert.deepEqual(codeChannels({ online: true, hasConfirmedEmail: true }), ['email', 'sms'])
})
test('online customer without a confirmed email: SMS only', () => {
  assert.deepEqual(codeChannels({ online: true, hasConfirmedEmail: false }), ['sms'])
})
test('cash customer: SMS first, even with an email; email only as the backup', () => {
  assert.deepEqual(codeChannels({ online: false, hasConfirmedEmail: true }), ['sms', 'email'])
  assert.deepEqual(codeChannels({ online: false, hasConfirmedEmail: false }), ['sms'])
})
