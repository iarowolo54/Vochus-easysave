// Integration tests for POST /api/customer/enroll: the server now enforces the
// field rules the UI enforces, requires a verified email, and consumes that
// verification. Request/response shape is unchanged.
//
// NEXTAUTH_SECRET is read at module load by customer-auth, so set it BEFORE the
// route is imported (done via dynamic import in `before`).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-enroll'

const rid = Math.random().toString(36).slice(2, 10)
const aid = `EN-${rid}`
const email = `enroll_${rid}@example.com`
const phone = '0802' + String(Math.floor(1000000 + Math.random() * 9000000))
let POST: (req: any) => Promise<Response>
let agentId = ''
const createdCustomerIds: string[] = []

// Each request gets a distinct client IP so the per-IP enrol rate limit (10/hr)
// does not throttle this file's many POSTs; the limit itself is tested in
// enroll-rate-limit.int.test.ts.
let ipSeq = 0
function req(body: Record<string, unknown>) {
  const ip = `192.0.2.${++ipSeq}`
  return { json: async () => body, headers: { get: (n: string) => (n.toLowerCase() === 'x-forwarded-for' ? ip : null) } }
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    aid,
    firstName: 'Ada', lastName: 'Obi',
    phone, email,
    address: '12 Allen Avenue, Ikeja',
    nokName: 'Chidi Obi', nokRelation: 'Brother', nokPhone: '08090001122',
    password: 'secret1',
    gender: 'Female', state: 'Lagos', lga: 'Ikeja',
    dailyAmount: 500, periodDays: 90, goal: 'Rent',
    ...overrides,
  }
}

async function verifyEmail(e: string) {
  await prisma.emailOTP.create({
    data: { email: e, code: '000000', verified: true, expiresAt: new Date(Date.now() + 10 * 60_000) },
  })
}

before(async () => {
  ;({ POST } = await import('../src/app/api/customer/enroll/route'))
  const a = await prisma.agent.create({ data: { agentId: aid, phone: `0751${rid}`, name: 'Agent E', location: 'Ikeja', password: 'x' } })
  agentId = a.id
})

after(async () => {
  await prisma.savingsPlan.deleteMany({ where: { customerId: { in: createdCustomerIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } })
  await prisma.emailOTP.deleteMany({ where: { email } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('rejects enrolment when the email was not verified', async () => {
  const res = await POST(req(validBody({ email: `unverified_${rid}@example.com` })))
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /email/i)
})

test('rejects a bad phone, short address, matching NOK phone, short password', async () => {
  await verifyEmail(email)
  assert.equal((await POST(req(validBody({ phone: '12345' })))).status, 400)
  assert.equal((await POST(req(validBody({ address: 'short' })))).status, 400)
  assert.equal((await POST(req(validBody({ nokPhone: phone })))).status, 400)
  assert.equal((await POST(req(validBody({ password: '123' })))).status, 400)
  // #18: gender required (Female/Male), state validated.
  assert.equal((await POST(req(validBody({ gender: undefined })))).status, 400)
  assert.equal((await POST(req(validBody({ gender: 'Other' })))).status, 400)
  assert.equal((await POST(req(validBody({ state: 'Atlantis' })))).status, 400)
  assert.equal((await POST(req(validBody({ state: undefined })))).status, 400) // state required
  assert.equal((await POST(req(validBody({ lga: undefined })))).status, 400) // lga required
  assert.equal((await POST(req(validBody({ lga: 'Kano Municipal' })))).status, 400) // lga not in Lagos
})

test('creates the customer with a verified email and consumes the OTP', async () => {
  await prisma.emailOTP.deleteMany({ where: { email } })
  await verifyEmail(email)
  const res = await POST(req(validBody()))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(body.customerId, 'returns customerId (shape unchanged)')
  const created = await prisma.customer.findFirst({ where: { phone } })
  assert.ok(created)
  assert.equal(created!.gender, 'Female') // #18 saved
  assert.equal(created!.state, 'Lagos')
  assert.equal(created!.lga, 'Ikeja')
  createdCustomerIds.push(created!.id)
  // The verification row is consumed so it can't be replayed.
  const leftover = await prisma.emailOTP.findFirst({ where: { email, verified: true } })
  assert.equal(leftover, null)
})
