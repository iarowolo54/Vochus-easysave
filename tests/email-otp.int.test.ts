// Integration tests for the email-OTP send + verify handlers against dev.db:
// crypto codes, per-email 60s send throttle, verify attempt-limit, and
// email-only lookup with constant-time compare.
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { POST as sendOtp } from '../src/app/api/customer/email-otp/route'
import { POST as verifyOtp } from '../src/app/api/customer/email-otp/verify/route'
import { enrolRateLimiter } from '../src/lib/rate-limit'

const rid = Math.random().toString(36).slice(2, 10)
const email = `otp_${rid}@example.com`

function req(body: unknown, ip = `198.51.100.${Math.floor(Math.random() * 254) + 1}`) {
  return {
    json: async () => body,
    headers: { get: (h: string) => (h.toLowerCase() === 'x-forwarded-for' ? ip : null) },
  } as unknown as Request
}

beforeEach(() => enrolRateLimiter.reset())

after(async () => {
  await prisma.emailOTP.deleteMany({ where: { email } })
  await prisma.$disconnect()
})

test('verify locks the code after 5 wrong attempts', async () => {
  await prisma.emailOTP.deleteMany({ where: { email } })
  await prisma.emailOTP.create({
    data: { email, code: '135790', expiresAt: new Date(Date.now() + 10 * 60_000), verified: false },
  })
  const ip = '203.0.113.7'
  for (let i = 0; i < 5; i++) {
    const r = await verifyOtp(req({ email, code: '000000' }, ip) as any)
    assert.equal(r.status, 400, `wrong attempt ${i + 1}`)
  }
  // 6th attempt — even with the CORRECT code — is refused: the code is burned.
  const sixth = await verifyOtp(req({ email, code: '135790' }, ip) as any)
  assert.equal(sixth.status, 400)
  const row = await prisma.emailOTP.findFirst({ where: { email } })
  assert.equal(row?.verified, false)
})

test('verify accepts the correct code within the attempt budget', async () => {
  await prisma.emailOTP.deleteMany({ where: { email } })
  await prisma.emailOTP.create({
    data: { email, code: '246802', expiresAt: new Date(Date.now() + 10 * 60_000), verified: false },
  })
  await verifyOtp(req({ email, code: '111111' }, '203.0.113.8') as any) // one wrong
  const ok = await verifyOtp(req({ email, code: '246802' }, '203.0.113.8') as any)
  assert.equal(ok.status, 200)
  const row = await prisma.emailOTP.findFirst({ where: { email } })
  assert.equal(row?.verified, true)
})

test('send issues a 6-digit code and throttles a second send within 60s', async () => {
  await prisma.emailOTP.deleteMany({ where: { email } })
  const first = await sendOtp(req({ email }, '203.0.113.9') as any)
  assert.equal(first.status, 200)
  const row = await prisma.emailOTP.findFirst({ where: { email } })
  assert.match(row!.code, /^\d{6}$/)
  const second = await sendOtp(req({ email }, '203.0.113.10') as any)
  assert.equal(second.status, 429)
})
