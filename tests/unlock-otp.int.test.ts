// Integration test for the OTP unlock library against the worktree's local DB.
// Uses a fake customerId (AccountUnlockOtp has no FK to Customer) and a known
// code via createUnlockOtp so we can exercise verify without the code ever being
// returned from requestUnlockOtp.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import {
  createUnlockOtp,
  verifyUnlockOtp,
  requestUnlockOtp,
  MAX_VERIFY_ATTEMPTS,
} from '../src/lib/unlock-otp'

const rid = Math.random().toString(36).slice(2, 10)
const customerId = `test-cust-${rid}`
const t0 = 1_000_000_000_000

after(async () => {
  await prisma.accountUnlockOtp.deleteMany({ where: { customerId } })
  await prisma.$disconnect()
})

test('a correct code verifies once, then is consumed', async () => {
  await createUnlockOtp(customerId, 'sms', '111111', t0)
  assert.equal((await verifyUnlockOtp(customerId, '999999', t0 + 1000)).ok, false) // wrong
  assert.equal((await verifyUnlockOtp(customerId, '111111', t0 + 2000)).ok, true) // right
  assert.equal((await verifyUnlockOtp(customerId, '111111', t0 + 3000)).ok, false) // already consumed
})

test('an expired code does not verify', async () => {
  await createUnlockOtp(customerId, 'sms', '222222', t0)
  const r = await verifyUnlockOtp(customerId, '222222', t0 + 60 * 60_000) // 1h later
  assert.equal(r.ok, false)
})

test('too many wrong attempts locks out the code', async () => {
  await createUnlockOtp(customerId, 'sms', '333333', t0)
  for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
    await verifyUnlockOtp(customerId, '000000', t0 + i * 1000)
  }
  // Even the correct code no longer works once attempts are exhausted.
  const r = await verifyUnlockOtp(customerId, '333333', t0 + 10_000)
  assert.equal(r.ok, false)
})

test('requestUnlockOtp sends, stores a hashed code, and rate-limits resends', async () => {
  const customer = { id: `${customerId}-req`, email: null, phone: '08012345678', firstName: 'Ada' }
  const first = await requestUnlockOtp(customer, t0)
  assert.equal(first.sent, true)
  assert.equal(first.channel, 'sms')
  const rows = await prisma.accountUnlockOtp.findMany({ where: { customerId: customer.id } })
  assert.equal(rows.length, 1)
  assert.notEqual(rows[0].codeHash, '') // a hash is stored, not the code

  // Immediate resend is throttled.
  const second = await requestUnlockOtp(customer, t0 + 1000)
  assert.equal(second.sent, false)
  assert.ok((second.retryAfterSeconds ?? 0) > 0)

  await prisma.accountUnlockOtp.deleteMany({ where: { customerId: customer.id } })
})
