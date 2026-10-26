// Acceptance test: drive the real customer-login POST handler against the local
// dev.db and prove the throttle returns 429 + Retry-After after repeated failures.
// The failure path needs no seeded customer and no secrets.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { POST } from '../src/app/api/customer/auth/login/route'

const rid = Math.random().toString(36).slice(2, 10)
const phone = `+234900${rid}`
const ip = `192.0.2.${Math.floor(Math.random() * 254) + 1}`

function mockReq(body: unknown, xff: string | null) {
  return {
    json: async () => body,
    headers: { get: (h: string) => (h.toLowerCase() === 'x-forwarded-for' ? xff : null) },
  } as unknown as Parameters<typeof POST>[0]
}

after(async () => {
  await prisma.loginAttempt.deleteMany({
    where: { OR: [{ key: `phone:${phone}` }, { key: `ip:${ip}` }] },
  })
  await prisma.$disconnect()
})

test('repeated wrong passwords get 401s, then a 429 with Retry-After', async () => {
  for (let i = 0; i < 5; i++) {
    const res = await POST(mockReq({ phone, password: 'wrong-guess' }, ip))
    assert.equal(res.status, 401, `attempt ${i + 1} should be 401`)
  }

  const blocked = await POST(mockReq({ phone, password: 'wrong-guess' }, ip))
  assert.equal(blocked.status, 429)
  const retryAfter = blocked.headers.get('Retry-After')
  assert.ok(retryAfter && Number(retryAfter) > 0, `Retry-After header present: ${retryAfter}`)
  const body = (await blocked.json()) as { error: string }
  assert.match(body.error, /too many attempts/i)
})
