// Which way an agent's unlock code goes: a verified email first (SMS costs money), otherwise their phone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentRecoveryChannel } from '../src/lib/unlock-otp'

const phone = '08012345678'

test('a verified email gets the code by email', () => {
  assert.deepEqual(agentRecoveryChannel({ email: 'a@x.ng', emailVerified: true, phone }), { channel: 'email', target: 'a@x.ng' })
})

test('an email nobody confirmed is never used: the code goes by SMS', () => {
  assert.deepEqual(agentRecoveryChannel({ email: 'a@x.ng', emailVerified: false, phone }), { channel: 'sms', target: phone })
})

test('no email means SMS, and a blank one counts as none', () => {
  assert.deepEqual(agentRecoveryChannel({ email: null, emailVerified: false, phone }), { channel: 'sms', target: phone })
  assert.deepEqual(agentRecoveryChannel({ email: '  ', emailVerified: true, phone }), { channel: 'sms', target: phone })
})
