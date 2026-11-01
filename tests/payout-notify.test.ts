import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentNotifyChannel, customerNotifyChannel } from '../src/lib/payout-notify'

const phone = '08012345678'

test('agent with email is notified by email', () => {
  assert.deepEqual(agentNotifyChannel({ email: 'a@b.co', phone }), { via: 'email', to: 'a@b.co' })
})

test('agent with null or empty email falls back to sms', () => {
  assert.deepEqual(agentNotifyChannel({ email: null, phone }), { via: 'sms', to: phone })
  assert.deepEqual(agentNotifyChannel({ email: '', phone }), { via: 'sms', to: phone })
})

test('online customer with email gets email', () => {
  assert.deepEqual(customerNotifyChannel({ email: 'c@d.co', phone }, 'online'), { via: 'email', to: 'c@d.co' })
})

test('online customer without email gets sms', () => {
  assert.deepEqual(customerNotifyChannel({ email: null, phone }, 'online'), { via: 'sms', to: phone })
})

test('offline customer always gets sms', () => {
  assert.deepEqual(customerNotifyChannel({ email: 'c@d.co', phone }, 'offline'), { via: 'sms', to: phone })
})
