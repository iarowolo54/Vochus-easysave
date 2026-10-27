// Acceptance test: drive the real customer-login POST handler against the local
// dev.db. Proves the account hard-locks (423) after 4 failures and that a locked
// account freezes biometric too. The failure path needs no seeded customer.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { POST } from '../src/app/api/customer/auth/login/route'

const rid = Math.random().toString(36).slice(2, 10)
const phone = `+234900${rid}`
const bioPhone = `+234901${rid}`
const ip = `192.0.2.${Math.floor(Math.random() * 254) + 1}`

function mockReq(body: unknown, xff: string | null) {
  return {
    json: async () => body,
    headers: { get: (h: string) => (h.toLowerCase() === 'x-forwarded-for' ? xff : null) },
  } as unknown as Parameters<typeof POST>[0]
}

after(async () => {
  await prisma.loginAttempt.deleteMany({
    where: { OR: [{ key: `phone:${phone}` }, { key: `phone:${bioPhone}` }, { key: `ip:${ip}` }] },
  })
  await prisma.$disconnect()
})

test('3 wrong passwords return 401; the 4th locks the account with 423', async () => {
  for (let i = 0; i < 3; i++) {
    const res = await POST(mockReq({ phone, password: 'wrong' }, ip))
    assert.equal(res.status, 401, `attempt ${i + 1} should be 401`)
  }
  const fourth = await POST(mockReq({ phone, password: 'wrong' }, ip))
  assert.equal(fourth.status, 423, '4th failure should lock (423)')
  const body = (await fourth.json()) as { locked?: boolean }
  assert.equal(body.locked, true)

  // Subsequent attempts stay 423 (no time expiry).
  const next = await POST(mockReq({ phone, password: 'wrong' }, ip))
  assert.equal(next.status, 423)
})

test('a locked account freezes biometric too (full freeze)', async () => {
  for (let i = 0; i < 4; i++) {
    await POST(mockReq({ phone: bioPhone, password: 'wrong' }, ip))
  }
  const bio = await POST(mockReq({ phone: bioPhone, biometricToken: 'tok', deviceId: 'dev-1' }, ip))
  assert.equal(bio.status, 423, 'biometric must be refused while locked')
})

test('a non-string phone is rejected with 400, not a 500', async () => {
  const res = await POST(mockReq({ phone: 1234567, password: 'x' }, ip))
  assert.equal(res.status, 400)
})
