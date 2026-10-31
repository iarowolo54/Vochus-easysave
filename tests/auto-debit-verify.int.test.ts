// Integration test: POST /api/customer/auto-debit/verify
process.env.PAYSTACK_SECRET_KEY = 'sk_test_autodebitverify'
process.env.NEXTAUTH_URL = 'http://localhost:3000'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'

const rid = Math.random().toString(36).slice(2, 8)
const DAY = 24 * 60 * 60 * 1000
let agentId = ''
const customerIds: string[] = []
const planIds: string[] = []
const refs: string[] = []

let currentToken = ''
const require_ = createRequire(import.meta.url)
const headersPath = require_.resolve('next/headers')
require_.cache[headersPath] = {
  id: headersPath, filename: headersPath, loaded: true, children: [], paths: [],
  exports: { cookies: async () => ({ get: (n: string) => (n === 'customer_token' && currentToken ? { name: n, value: currentToken } : undefined) }) },
} as unknown as NodeJS.Module

async function mk(n: number, source = 'self') {
  const c = await prisma.customer.create({
    data: { customerId: `ADV-${rid}-${n}`, agentId, firstName: 'C', lastName: 'X', phone: `08${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 180 * DAY), balance: 0, status: 'Active', source },
  })
  planIds.push(plan.id)
  const ref = `addenroll-${plan.id}-${rid}${n}`
  refs.push(ref)
  await prisma.paymentIntent.create({ data: { ref, actorType: 'customer', customerId: c.id, planId: plan.id, amount: 50 } })
  return { c, plan, ref }
}

async function call(c: { id: string; customerId: string } | null, reference: string) {
  if (c) {
    const { signCustomerToken } = await import('../src/lib/customer-auth')
    currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId })
  } else currentToken = ''
  const { POST } = await import('../src/app/api/customer/auto-debit/verify/route')
  const res = await POST(new NextRequest('http://localhost/api/customer/auto-debit/verify', { method: 'POST', body: JSON.stringify({ reference }) }))
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `ADV-${rid}`, phone: `0796${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
})

after(async () => {
  await prisma.transaction.deleteMany({ where: { ref: { in: refs } } })
  await prisma.customerPayment.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.autoDebitMandate.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.paymentIntent.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('verified enrollment: active mandate, N50 credited once, no auth code leaked; replay idempotent', async () => {
  const { c, plan, ref } = await mk(1)
  const r = await call(c, ref)
  assert.equal(r.status, 200)
  assert.equal(r.body.active, true)
  assert.ok(!/authorizationCode|AUTH_test|SIG_test/i.test(r.text))
  const m = await prisma.autoDebitMandate.findUnique({ where: { savingsPlanId: plan.id } })
  assert.equal(m?.status, 'active')
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 50)
  assert.equal(await prisma.transaction.count({ where: { ref, type: 'saving' } }), 1)

  const r2 = await call(c, ref)
  assert.equal(r2.status, 200)
  assert.equal(r2.body.active, true)
  assert.ok(!/authorizationCode|AUTH_test|SIG_test/i.test(r2.text))
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 50)
  assert.equal(await prisma.transaction.count({ where: { ref } }), 1)
})

test('unknown reference: 403', async () => {
  const { c } = await mk(2)
  assert.equal((await call(c, `addenroll-nope-${rid}`)).status, 403)
})

test("another customer's reference: 403, nothing credited", async () => {
  const { plan, ref } = await mk(3)
  const { c: other } = await mk(4)
  assert.equal((await call(other, ref)).status, 403)
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 0)
})

test('no session: 401', async () => {
  const { ref } = await mk(5)
  assert.equal((await call(null, ref)).status, 401)
})

test('non-reusable card: no mandate, N50 credited once as saving, savedInstead; replay stays one credit', async () => {
  const { c, plan } = await mk(6)
  // test-mode verifyTransaction returns reusable:false for refs carrying this marker
  const ref = `addenroll-nonreusable-${plan.id}-${rid}6`
  refs.push(ref)
  await prisma.paymentIntent.create({ data: { ref, actorType: 'customer', customerId: c.id, planId: plan.id, amount: 50 } })
  const r = await call(c, ref)
  assert.equal(r.status, 200)
  assert.equal(r.body.active, false)
  assert.equal(r.body.savedInstead, true)
  assert.ok(!/authorizationCode|AUTH_test|SIG_test/i.test(r.text))
  assert.equal(await prisma.autoDebitMandate.count({ where: { savingsPlanId: plan.id } }), 0)
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 50)
  const txs = await prisma.transaction.findMany({ where: { ref } })
  assert.equal(txs.length, 1)
  assert.equal(txs[0].type, 'saving')
  assert.equal(txs[0].amount, 50)
  assert.equal(txs[0].planId, plan.id)
  assert.equal(txs[0].status, 'Done')

  const r2 = await call(c, ref)
  assert.equal(r2.status, 200)
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 50)
  assert.equal(await prisma.transaction.count({ where: { ref } }), 1)
  assert.equal(await prisma.autoDebitMandate.count({ where: { savingsPlanId: plan.id } }), 0)
})

test('success but no authorization returned: N50 still credited as saving, savedInstead; replay stays one credit (handoff #31)', async () => {
  const { c, plan } = await mk(7)
  // test-mode verifyTransaction returns success with NO authorization for refs carrying 'noauth'
  const ref = `addenroll-noauth-${plan.id}-${rid}7`
  refs.push(ref)
  await prisma.paymentIntent.create({ data: { ref, actorType: 'customer', customerId: c.id, planId: plan.id, amount: 50 } })
  const r = await call(c, ref)
  assert.equal(r.status, 200)
  assert.equal(r.body.active, false)
  assert.equal(r.body.savedInstead, true)
  assert.equal(await prisma.autoDebitMandate.count({ where: { savingsPlanId: plan.id } }), 0)
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 50)
  const txs = await prisma.transaction.findMany({ where: { ref } })
  assert.equal(txs.length, 1)
  assert.equal(txs[0].type, 'saving')
  assert.equal(txs[0].amount, 50)
  assert.equal(txs[0].status, 'Done')

  // Replay: the pending intent was consumed, so a second verify credits nothing more.
  const r2 = await call(c, ref)
  assert.equal(r2.status, 200)
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 50)
  assert.equal(await prisma.transaction.count({ where: { ref } }), 1)
})
