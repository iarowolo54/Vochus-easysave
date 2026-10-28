import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateCode,
  hashCode,
  pickChannel,
  maskTarget,
} from '../src/lib/unlock-otp'

test('generateCode is a 6-digit numeric string', () => {
  for (let i = 0; i < 50; i++) {
    const c = generateCode()
    assert.match(c, /^\d{6}$/)
  }
})

test('hashCode is a deterministic 64-hex SHA-256, not the code itself', () => {
  const h = hashCode('123456')
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.equal(h, hashCode('123456'))
  assert.notEqual(h, hashCode('123457'))
  assert.notEqual(h, '123456')
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
