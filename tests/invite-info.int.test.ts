// Integration tests for GET /api/customer/enroll/invite: unauthenticated trust
// card (agent first name, area, downscaled photo thumbnail) with IP limiting.
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { GET } from '../src/app/api/customer/enroll/invite/route'
import { enrolRateLimiter } from '../src/lib/rate-limit'

const rid = Math.random().toString(36).slice(2, 10)
const aid = `IV-${rid}`
// 1x1 PNG, as a data URL — stands in for the agent's base64 photo column.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
let agentId = ''

function req(query: string, ip = '192.0.2.70') {
  return {
    url: `http://localhost/api/customer/enroll/invite${query}`,
    headers: { get: (h: string) => (h.toLowerCase() === 'x-forwarded-for' ? ip : null) },
  } as unknown as Parameters<typeof GET>[0]
}

test('setup: agent with a photo', async () => {
  const a = await prisma.agent.create({
    data: { agentId: aid, phone: `0741${rid}`, name: 'Tunde Bello', location: 'Ikeja', password: 'x', photoUrl: PNG },
  })
  agentId = a.id
})

after(async () => {
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

beforeEach(() => enrolRateLimiter.reset())

test('returns first name, area and a downscaled thumbnail — not the full column', async () => {
  const res = await GET(req(`?aid=${aid}`))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.firstName, 'Tunde')
  assert.equal(body.area, 'Ikeja')
  assert.ok(typeof body.photo === 'string' && body.photo.startsWith('data:image/'))
  // Must not leak the raw column verbatim.
  assert.notEqual(body.photo, PNG)
  // No surname, phone, password, or other agent fields.
  assert.deepEqual(Object.keys(body).sort(), ['area', 'firstName', 'photo'])
})

test('unknown invite is a 404', async () => {
  const res = await GET(req('?aid=does-not-exist'))
  assert.equal(res.status, 404)
})

test('missing params is a 404 (nothing to look up)', async () => {
  const res = await GET(req(''))
  assert.equal(res.status, 404)
})

test('per-IP rate limit applies', async () => {
  const ip = '192.0.2.71'
  let last = 200
  for (let i = 0; i < 32; i++) last = (await GET(req(`?aid=${aid}`, ip))).status
  assert.equal(last, 429)
})
