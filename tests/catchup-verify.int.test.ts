// Integration test: POST /api/customer/paystack/verify for a catch-up intent (coversKeys set).
process.env.PAYSTACK_SECRET_KEY = 'sk_test_catchupverify'
process.env.NEXTAUTH_URL = 'http://localhost:3000'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import { accruedInterestForPlan } from '../src/lib/savings-interest-plan'
import { dateKey } from '../src/lib/savings-card'

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

// kobo the Paystack verify stub should report, keyed by reference.
const koboByRef = new Map<string, number>()
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url.toString()
  const m = u.match(/\/transaction\/verify\/([^/?]+)/)
  if (m) {
    const ref = decodeURIComponent(m[1])
    const amount = koboByRef.get(ref) ?? 0
    return new Response(JSON.stringify({ status: true, data: { status: 'success', amount, currency: 'NGN', channel: 'card' } }), { status: 200 })
  }
  return realFetch(url as never, init)
}) as typeof fetch

async function mk(n: number) {
  const start = new Date(Date.now() - 20 * DAY)
  const c = await prisma.customer.create({
    data: { customerId: `CUV-${rid}-${n}`, agentId, firstName: 'C', lastName: 'X', phone: `08${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 180, cadence: 'daily', goal: 'x', startDate: start, maturityDate: new Date(Date.now() + 160 * DAY), balance: 1000, status: 'Active', source: 'self' },
  })
  planIds.push(plan.id)
  // a past deposit so accrued interest is meaningfully non-trivial
  await prisma.transaction.create({
    data: { ref: `CUV-seed-${rid}-${n}`, agentId, customerId: c.id, planId: plan.id, type: 'saving', amount: 1000, status: 'Done', createdAt: new Date(Date.now() - 15 * DAY) },
  })
  refs.push(`CUV-seed-${rid}-${n}`)
  return { c, plan }
}

async function mkIntent(c: { id: string }, planId: string, keys: string[], amount: number, n: number) {
  const ref = `VCHS-CST-${rid}-${n}-${Date.now()}`
  refs.push(ref)
  koboByRef.set(ref, Math.round(amount * 100))
  await prisma.paymentIntent.create({
    data: { ref, actorType: 'customer', customerId: c.id, planId, amount, coversKeys: JSON.stringify(keys) },
  })
  return ref
}

async function call(c: { id: string; customerId: string }, reference: string) {
  const { signCustomerToken } = await import('../src/lib/customer-auth')
  currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId })
  const { POST } = await import('../src/app/api/customer/paystack/verify/route')
  const res = await POST(new NextRequest('http://localhost/api/customer/paystack/verify', { method: 'POST', body: JSON.stringify({ reference }) }))
  const text = await res.text()
  return { status: res.status, body: JSON.parse(text) }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `CUV-${rid}`, phone: `0799${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
})

after(async () => {
  await prisma.transaction.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.customerPayment.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.planDayCoverage.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.paymentIntent.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  globalThis.fetch = realFetch
  await prisma.$disconnect()
})

test('catch-up verify: one now-stamped saving credit, coverage per key, CustomerPayment; interest invariant; replay idempotent', async () => {
  const { c, plan } = await mk(1)
  const keys = [dateKey(new Date(Date.now() - 5 * DAY)), dateKey(new Date(Date.now() - 4 * DAY)), dateKey(new Date(Date.now() - 3 * DAY))]
  const total = 300
  const ref = await mkIntent(c, plan.id, keys, total, 1)

  const asOf = new Date()
  const interestBefore = await accruedInterestForPlan(prisma, plan, asOf)
  const balanceBefore = (await prisma.savingsPlan.findUniqueOrThrow({ where: { id: plan.id } })).balance

  const r = await call(c, ref)
  assert.equal(r.status, 200)

  // one saving credit for the intent amount, stamped ~now (NOT backdated to a past key)
  const txs = await prisma.transaction.findMany({ where: { ref } })
  assert.equal(txs.length, 1)
  assert.equal(txs[0].type, 'saving')
  assert.equal(txs[0].amount, total)
  const stampAgeMs = Date.now() - txs[0].createdAt.getTime()
  assert.ok(stampAgeMs >= 0 && stampAgeMs < 60_000, 'credit stamped ~now, not a past key')

  // balance incremented by the total
  const after = await prisma.savingsPlan.findUniqueOrThrow({ where: { id: plan.id } })
  assert.equal(after.balance, balanceBefore + total)

  // one PlanDayCoverage per key, tagged with the transaction ref
  const cov = await prisma.planDayCoverage.findMany({ where: { savingsPlanId: plan.id } })
  assert.equal(cov.length, keys.length)
  assert.deepEqual(cov.map(x => x.coversKey).sort(), [...keys].sort())
  assert.ok(cov.every(x => x.ref === ref))

  // a CustomerPayment row
  assert.equal(await prisma.customerPayment.count({ where: { planId: plan.id } }), 1)

  // interest invariance: the now-stamped credit must not change accrued interest as of `asOf`
  const interestAfter = await accruedInterestForPlan(prisma, plan, asOf)
  assert.equal(interestAfter, interestBefore)

  // replay: same ref credits once, coverage rows stay once
  const r2 = await call(c, ref)
  assert.equal(r2.status, 200)
  assert.equal(r2.body.alreadyProcessed, true)
  assert.equal(await prisma.transaction.count({ where: { ref } }), 1)
  assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: plan.id } })).balance, balanceBefore + total)
  assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), keys.length)
})

test('normal (non-catch-up) verify still works: no coverage rows written', async () => {
  const { c, plan } = await mk(2)
  const ref = `VCHS-CST-${rid}-2-plain-${Date.now()}`
  refs.push(ref)
  koboByRef.set(ref, 50000)
  await prisma.paymentIntent.create({ data: { ref, actorType: 'customer', customerId: c.id, planId: plan.id, amount: 500 } })
  const r = await call(c, ref)
  assert.equal(r.status, 200)
  assert.equal(await prisma.transaction.count({ where: { ref, type: 'saving' } }), 1)
  assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), 0)
})
