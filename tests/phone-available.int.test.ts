// Integration tests for POST /api/customer/phone-available: boolean-only
// availability check with phone validation and per-IP rate limiting.
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { POST } from '../src/app/api/customer/phone-available/route'
import { enrolRateLimiter } from '../src/lib/rate-limit'

const rid = Math.random().toString(36).slice(2, 10)
const takenPhone = '0801' + String(Math.floor(1000000 + Math.random() * 9000000)) // 11 digits, starts 0
let agentId = ''
let customerId = ''

function req(body: unknown, ip: string) {
  return {
    json: async () => body,
    headers: { get: (h: string) => (h.toLowerCase() === 'x-forwarded-for' ? ip : null) },
  } as unknown as Parameters<typeof POST>[0]
}

beforeEach(() => enrolRateLimiter.reset())

test('setup: create a customer holding a phone', async () => {
  const a = await prisma.agent.create({ data: { agentId: `PA-${rid}`, phone: `0731${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: {
      customerId: `PA-${rid}`, agentId: a.id, firstName: 'A', lastName: 'B', phone: takenPhone,
      address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800',
    },
  })
  customerId = c.id
})

after(async () => {
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('a registered number is not available; only a boolean is returned', async () => {
  const res = await POST(req({ phone: takenPhone }, '192.0.2.50'))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(Object.keys(body), ['available'])
  assert.equal(body.available, false)
})

test('an unregistered valid number is available', async () => {
  const res = await POST(req({ phone: '09098765432' }, '192.0.2.51'))
  assert.equal((await res.json()).available, true)
})

test('an invalid phone is a 400', async () => {
  for (const bad of ['123', '1234567890', '0803abc1234', '080312345678']) {
    const res = await POST(req({ phone: bad }, '192.0.2.52'))
    assert.equal(res.status, 400, `"${bad}" should be 400`)
  }
})

test('per-IP rate limit kicks in', async () => {
  const ip = '192.0.2.99'
  let last = 200
  for (let i = 0; i < 12; i++) {
    last = (await POST(req({ phone: '09011112222' }, ip))).status
  }
  assert.equal(last, 429)
})
