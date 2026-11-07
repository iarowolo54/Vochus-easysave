import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectionCodeChannels } from '../src/lib/customer-channels'

const confirmed = new Date('2026-11-01')

test('online customer with a confirmed email: the collection code goes by email only (no SMS cost)', () => {
  assert.deepEqual(collectionCodeChannels({ online: true, email: 'a@b.test', emailVerifiedAt: confirmed }), ['email'])
})

test('online customer without a confirmed email: SMS, and never to the unconfirmed address', () => {
  assert.deepEqual(collectionCodeChannels({ online: true, email: 'typed@b.test', emailVerifiedAt: null }), ['sms'])
  assert.deepEqual(collectionCodeChannels({ online: true, email: null }), ['sms'])
  assert.deepEqual(collectionCodeChannels({ online: true, email: '  ', emailVerifiedAt: confirmed }), ['sms'])
})

test('cash customer always gets the SMS; a confirmed email is added, an unconfirmed one is not', () => {
  assert.deepEqual(collectionCodeChannels({ online: false, email: null }), ['sms'])
  assert.deepEqual(collectionCodeChannels({ online: false, email: 'typed@b.test', emailVerifiedAt: null }), ['sms'])
  assert.deepEqual(collectionCodeChannels({ online: false, email: 'a@b.test', emailVerifiedAt: confirmed }), ['sms', 'email'])
})
