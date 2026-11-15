// A sign-up whose reply was lost (weak connection) is sent again: the same email, phone and password under the
// same agent sign the customer in instead of answering "already registered". A wrong password, or another
// agent's link, still gets the normal refusal. Writes throwaway rows to the local dev.db and removes them.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-enroll-resume'

const rid = Math.random().toString(36).slice(2, 10)
const aid = `ER-${rid}`
const otherAid = `ER2-${rid}`
const email = `resume_${rid}@example.com`
const phone = '0803' + String(Math.floor(1000000 + Math.random() * 9000000))
let POST: (req: any) => Promise<Response>
const agentIds: string[] = []

let ipSeq = 0
function req(body: Record<string, unknown>) {
  const ip = `198.51.100.${++ipSeq}`
  return { json: async () => body, headers: { get: (n: string) => (n.toLowerCase() === 'x-forwarded-for' ? ip : null) } }
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    aid,
    firstName: 'Ada', lastName: 'Obi', phone, email,
    address: '12 Allen Avenue, Ikeja',
    nokName: 'Chidi Obi', nokRelation: 'Brother', nokPhone: '08090001122',
    password: 'secret1',
    gender: 'Female', state: 'Lagos', lga: 'Ikeja', dob: '1990-05-01', photoUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==',
    dailyAmount: 500, periodDays: 90, goal: 'Rent',
    ...overrides,
  }
}

before(async () => {
  ;({ POST } = await import('../src/app/api/customer/enroll/route'))
  for (const [id, p] of [[aid, `0752${rid}`], [otherAid, `0753${rid}`]]) {
    const a = await prisma.agent.create({ data: { agentId: id, phone: p, name: 'Agent R', location: 'Ikeja', password: 'x' } })
    agentIds.push(a.id)
  }
  await prisma.emailOTP.create({ data: { email, code: '000000', verified: true, expiresAt: new Date(Date.now() + 10 * 60_000) } })
})

after(async () => {
  const cs = await prisma.customer.findMany({ where: { email }, select: { id: true } })
  const ids = cs.map(c => c.id)
  await prisma.savingsPlan.deleteMany({ where: { customerId: { in: ids } } })
  await prisma.customer.deleteMany({ where: { id: { in: ids } } })
  await prisma.emailOTP.deleteMany({ where: { email } })
  await prisma.loginAttempt.deleteMany({ where: { key: { contains: phone } } }) // the wrong-password try
  await prisma.agent.deleteMany({ where: { id: { in: agentIds } } })
  await prisma.$disconnect()
})

test('the first try opens the account', async () => {
  const res = await POST(req(body()))
  assert.equal(res.status, 200)
})

test('the same sign-up sent again signs them in with the same answer', async () => {
  const res = await POST(req(body()))
  assert.equal(res.status, 200)
  const d = await res.json()
  assert.match(d.customerId, /^CST-/)
  assert.equal(d.name, 'Ada Obi')
  assert.ok(d.plan, 'the first plan is returned')
  assert.match(res.headers.get('set-cookie') ?? '', /customer_token=/)
  assert.equal(await prisma.customer.count({ where: { email } }), 1, 'no second account')
})

test('a wrong password is refused as before', async () => {
  const res = await POST(req(body({ password: 'wrong99' })))
  assert.notEqual(res.status, 200)
  assert.equal(res.headers.get('set-cookie'), null)
})

test("another agent's link is refused as before", async () => {
  const res = await POST(req(body({ aid: otherAid })))
  assert.notEqual(res.status, 200)
  assert.equal(res.headers.get('set-cookie'), null)
})

test('entering the code for an email that has an account says it is taken; only then', async () => {
  const { POST: verify } = await import('../src/app/api/customer/email-otp/verify/route')
  await prisma.emailOTP.create({ data: { email, code: '123456', verified: false, expiresAt: new Date(Date.now() + 10 * 60_000) } })
  const wrong = await (await verify(req({ email, code: '654321' }) as any)).json()
  assert.equal(wrong.taken, undefined, 'a wrong code tells nothing')
  const right = await (await verify(req({ email, code: '123456' }) as any)).json()
  assert.equal(right.verified, true)
  assert.equal(right.taken, true)
})

test('an expired email confirmation says so with a code the page can act on', async () => {
  const res = await POST(req(body({ email: `fresh_${rid}@example.com`, phone: '0805' + String(Math.floor(1000000 + Math.random() * 9000000)) })))
  assert.equal(res.status, 400)
  assert.equal((await res.json()).code, 'email_unconfirmed')
})
