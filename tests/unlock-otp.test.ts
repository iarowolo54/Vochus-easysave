import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateCode,
  pickChannel,
  recoveryChannel,
  maskTarget,
} from '../src/lib/unlock-otp'

test('generateCode is a 6-digit numeric string', () => {
  for (let i = 0; i < 50; i++) {
    const c = generateCode()
    assert.match(c, /^\d{6}$/)
  }
})

test('pickChannel routes by registration type (email on file -> email, else sms)', () => {
  assert.deepEqual(pickChannel({ email: 'a@b.com', phone: '08012345678' }), {
    channel: 'email',
    target: 'a@b.com',
  })
  assert.deepEqual(pickChannel({ email: null, phone: '08012345678' }), {
    channel: 'sms',
    target: '08012345678',
  })
})

test('maskTarget hides most of the destination', () => {
  const em = maskTarget('email', 'johndoe@example.com')
  assert.match(em, /@example\.com$/)
  assert.ok(!em.includes('johndoe'))
  const sms = maskTarget('sms', '08012345678')
  assert.match(sms, /5678$/)
  assert.ok(!sms.includes('0801234'))
})

test('recoveryChannel ignores an unverified email', () => {
  const phone = '08012345678'
  assert.deepEqual(recoveryChannel({ email: 'agent@b.com', emailVerifiedAt: null, phone }), { channel: 'sms', target: phone })
  assert.deepEqual(recoveryChannel({ email: 'own@b.com', emailVerifiedAt: new Date(), phone }), { channel: 'email', target: 'own@b.com' })
})
