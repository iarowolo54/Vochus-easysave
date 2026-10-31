// Integration test: POST /api/customer/catchup/init
process.env.PAYSTACK_SECRET_KEY = 'sk_test_catchupinit'
process.env.NEXTAUTH_URL = 'http://localhost:3000'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import { buildSlots, dateKey } from '../src/lib/savings-card'

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

// Stub Paystack initialize: echo back the reference the route generated.
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url.toString()
  if (u.includes('/transaction/initialize')) {
    const sent = JSON.parse(String(init?.body ?? '{}'))
    return new Response(JSON.stringify({ status: true, data: { reference: sent.reference, authorization_url: 'https://checkout.paystack.test/x' } }), { status: 200 })
  }
  return realFetch(url as never, init)
}) as typeof fetch

async function mk(n: number, source: 'self' | 'agent' = 'self', cadence = 'daily') {
  const start = new Date(Date.now() - 10 * DAY)
  const c = await prisma.customer.create({
    data: { customerId: `CUI-${rid}-${n}`, agentId, firstName: 'C', lastName: 'X', phone: `08${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 180, cadence, goal: 'x', startDate: start, maturityDate: new Date(Date.now() + 180 * DAY), balance: 0, status: 'Active', source },
  })
  planIds.push(plan.id)
  return { c, plan, start }
}

async function missedKeys(planId: string): Promise<string[]> {
  const plan = await prisma.savingsPlan.findUniqueOrThrow({ where: { id: planId } })
  const deposits = await prisma.transaction.findMany({ where: { planId, type: 'saving', status: 'Done' }, select: { createdAt: true } })
  const cov = await prisma.planDayCoverage.findMany({ where: { savingsPlanId: planId }, select: { coversKey: true } })
  const slots = buildSlots(
    { startDate: plan.startDate.toISOString(), maturityDate: plan.maturityDate.toISOString(), periodDays: plan.periodDays, cadence: plan.cadence },
    deposits.map(d => d.createdAt.toISOString()),
    cov.map(x => x.coversKey),
  )
  return slots.filter(s => s.state === 'missed').map(s => s.key)
}

async function call(c: { id: string; customerId: string } | null, planId: string, keys: string[]) {
  if (c) {
    const { signCustomerToken } = await import('../src/lib/customer-auth')
    currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId })
  } else currentToken = ''
  const { POST } = await import('../src/app/api/customer/catchup/init/route')
  const res = await POST(new NextRequest('http://localhost/api/customer/catchup/init', { method: 'POST', body: JSON.stringify({ planId, keys }) }))
  const body = await res.json()
  if (body.reference) refs.push(body.reference)
  return { status: res.status, body }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `CUI-${rid}`, phone: `0798${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
})

after(async () => {
  await prisma.transaction.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.planDayCoverage.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.paymentIntent.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  globalThis.fetch = realFetch
  await prisma.$disconnect()
})

test('valid missed keys: 200 with authorizationUrl, non-addenroll ref, intent with coversKeys + server total', async () => {
  const { c, plan } = await mk(1)
  const missed = await missedKeys(plan.id)
  const keys = missed.slice(0, 3)
  const { status, body } = await call(c, plan.id, keys)
  assert.equal(status, 200)
  assert.ok(body.authorizationUrl)
  assert.ok(body.reference)
  assert.ok(!body.reference.startsWith('addenroll-'), 'must not be an addenroll- ref')
  const intent = await prisma.paymentIntent.findFirst({ where: { ref: body.reference } })
  assert.equal(intent?.status, 'Pending')
  assert.equal(intent?.amount, 300) // 100 * 3, server-computed
  assert.deepEqual(JSON.parse(intent?.coversKeys ?? '[]'), keys)
})

test('ineligible: monthly plan 400', async () => {
  const { c, plan } = await mk(2, 'self', 'monthly')
  assert.equal((await call(c, plan.id, [dateKey(new Date(Date.now() - 2 * DAY))])).status, 400)
})

test('ineligible: offline (agent) plan 400', async () => {
  const { c, plan } = await mk(3, 'agent')
  const missed = await missedKeys(plan.id)
  assert.equal((await call(c, plan.id, missed.slice(0, 1))).status, 400)
})

test('future key: 400', async () => {
  const { c, plan } = await mk(4)
  assert.equal((await call(c, plan.id, [dateKey(new Date(Date.now() + 2 * DAY))])).status, 400)
})

test('already-saved key: 400', async () => {
  const { c, plan } = await mk(5)
  const missed = await missedKeys(plan.id)
  const savedDay = missed[0]
  // stamp a deposit on that day so it is no longer missed
  await prisma.transaction.create({
    data: { ref: `CUI-dep-${rid}-5`, agentId, customerId: c.id, planId: plan.id, type: 'saving', amount: 100, status: 'Done', createdAt: new Date(savedDay + 'T10:00:00') },
  })
  assert.equal((await call(c, plan.id, [savedDay])).status, 400)
})

test('empty keys: 400', async () => {
  const { c, plan } = await mk(6)
  assert.equal((await call(c, plan.id, [])).status, 400)
})

test('>90 keys: 400', async () => {
  const { c, plan } = await mk(7)
  const keys = Array.from({ length: 91 }, (_, i) => dateKey(new Date(Date.now() - (i + 1) * DAY)))
  assert.equal((await call(c, plan.id, keys)).status, 400)
})

test("another customer's plan: 403/404, no intent", async () => {
  const { plan } = await mk(8)
  const { c: other } = await mk(9)
  const missed = await missedKeys(plan.id)
  const r = await call(other, plan.id, missed.slice(0, 1))
  assert.ok(r.status === 403 || r.status === 404)
  assert.equal(await prisma.paymentIntent.count({ where: { planId: plan.id } }), 0)
})

test('no session: 401', async () => {
  const { plan } = await mk(10)
  const missed = await missedKeys(plan.id)
  assert.equal((await call(null, plan.id, missed.slice(0, 1))).status, 401)
})
