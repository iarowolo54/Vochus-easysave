// Self-enrol must reject a phone/email already used by any account (409) and
// must not reveal which account owns it.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-enroll-identity'

const rid = Math.random().toString(36).slice(2, 10)
const aid = `EI-${rid}`
const takenPhone = '0803' + String(Math.floor(1000000 + Math.random() * 9000000))
const takenEmail = `taken_${rid}@x.com`
const newEmail = `fresh_${rid}@example.com`
const newPhone = '0804' + String(Math.floor(1000000 + Math.random() * 9000000))
let POST: (req: any) => Promise<Response>
let agentId = ''
let existingId = ''

function req(body: Record<string, unknown>) {
  return { json: async () => body, headers: { get: () => null } }
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    aid, firstName: 'Ada', lastName: 'Obi',
    phone: newPhone, email: newEmail,
    address: '12 Allen Avenue, Ikeja',
    nokName: 'Chidi Obi', nokRelation: 'Brother', nokPhone: '08090001122',
    password: 'secret1', gender: 'Female', state: 'Lagos', lga: 'Ikeja',
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
  const a = await prisma.agent.create({ data: { agentId: aid, phone: `0752${rid}`, name: 'Agent EI', location: 'Ikeja', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: {
      customerId: `CST-EI${rid}`, agentId, firstName: 'Old', lastName: 'Timer',
      phone: takenPhone, email: takenEmail, address: '1 Old Road, Ikeja',
      nokName: 'N', nokRelation: 'R', nokPhone: '08090009999', password: 'x',
    },
  })
  existingId = c.id
})

after(async () => {
  await prisma.savingsPlan.deleteMany({ where: { customer: { agentId } } })
  await prisma.customer.deleteMany({ where: { agentId } })
  await prisma.emailOTP.deleteMany({ where: { email: { in: [newEmail, takenEmail] } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('rejects self-enrol reusing an existing phone', async () => {
  await verifyEmail(newEmail)
  const res = await POST(req(validBody({ phone: takenPhone })))
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, 'This phone number is already registered.')
})

test('rejects self-enrol reusing an existing email', async () => {
  await verifyEmail(takenEmail)
  const res = await POST(req(validBody({ email: takenEmail })))
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, 'This email is already registered.')
  assert.ok(existingId)
})
