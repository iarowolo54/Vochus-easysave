// Integration test: POST /api/customer/catchup/init
process.env.PAYSTACK_SECRET_KEY = 'sk_test_catchupinit'
process.env.NEXTAUTH_URL = 'http://localhost:3000'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import { buildSlotsWat, watKey } from '../src/lib/savings-card'

const rid = Math.random().toString(36).slice(2, 8)
const DAY = 24 * 60 * 60 * 1000
let agentId = ''
const customerIds: string[] = []
const planIds: string[] = []
const refs: string[] = []
const mandateIds: string[] = []

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

async function slotsByState(planId: string, state: string): Promise<string[]> {
  const plan = await prisma.savingsPlan.findUniqueOrThrow({ where: { id: planId } })
  const deposits = await prisma.transaction.findMany({ where: { planId, type: 'saving', status: 'Done' }, select: { createdAt: true } })
  const cov = await prisma.planDayCoverage.findMany({ where: { savingsPlanId: planId }, select: { coversKey: true } })
  const slots = buildSlotsWat(
    { startDate: plan.startDate.toISOString(), maturityDate: plan.maturityDate.toISOString(), periodDays: plan.periodDays, cadence: plan.cadence },
    deposits.map(d => d.createdAt.toISOString()),
    cov.map(x => x.coversKey),
  )
  return slots.filter(s => s.state === state).map(s => s.key)
}
const missedKeys = (planId: string) => slotsByState(planId, 'missed')

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
  await prisma.autoDebitAttempt.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.autoDebitMandate.deleteMany({ where: { id: { in: mandateIds } } })
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
  assert.equal((await call(c, plan.id, [watKey(new Date(Date.now() - 2 * DAY))])).status, 400)
})

test('ineligible: offline (agent) plan 400', async () => {
  const { c, plan } = await mk(3, 'agent')
  const missed = await missedKeys(plan.id)
  assert.equal((await call(c, plan.id, missed.slice(0, 1))).status, 400)
})

test('today and upcoming keys: 200, charged at the plan rate', async () => {
  const { c, plan } = await mk(4)
  const today = await slotsByState(plan.id, 'today')
  const upcoming = await slotsByState(plan.id, 'upcoming')
  assert.equal(today.length, 1)
  const keys = [today[0], upcoming[0], upcoming[1]]
  const { status, body } = await call(c, plan.id, keys)
  assert.equal(status, 200)
  const intent = await prisma.paymentIntent.findFirst({ where: { ref: body.reference } })
  assert.equal(intent?.amount, 300)
  assert.deepEqual(JSON.parse(intent?.coversKeys ?? '[]'), keys)
})

test('a key past the end of the plan: 400', async () => {
  const { c, plan } = await mk(11)
  assert.equal((await call(c, plan.id, [watKey(new Date(Date.now() + 400 * DAY))])).status, 400)
})

test('a key already covered by a pay-ahead: 400', async () => {
  const { c, plan } = await mk(12)
  const [key] = await slotsByState(plan.id, 'upcoming')
  await prisma.planDayCoverage.create({ data: { savingsPlanId: plan.id, coversKey: key, ref: `CUI-cov-${rid}` } })
  assert.equal((await call(c, plan.id, [key])).status, 400)
})

test('a day auto-debit is charging right now: 409, no intent; other days still work', async () => {
  const { c, plan } = await mk(13)
  const m = await prisma.autoDebitMandate.create({
    data: { customerId: c.id, savingsPlanId: plan.id, authorizationCode: `AUTH_${rid}`, authSignature: 'sig', authEmail: 'a@b.c', status: 'active', amountPerCycle: 100, nextRunAt: new Date(Date.now() + DAY) },
  })
  mandateIds.push(m.id)
  await prisma.autoDebitAttempt.create({
    data: { mandateId: m.id, savingsPlanId: plan.id, reference: `autodebit-${plan.id}-x`, cycleDate: new Date(), creditAmount: 100, grossCharged: 102, feeEstimate: 2, status: 'processing' },
  })
  const [today] = await slotsByState(plan.id, 'today')
  const r = await call(c, plan.id, [today])
  assert.equal(r.status, 409)
  assert.equal(await prisma.paymentIntent.count({ where: { planId: plan.id } }), 0)
  const [next] = await slotsByState(plan.id, 'upcoming')
  assert.equal((await call(c, plan.id, [next])).status, 200)
})

test('a settled auto-debit attempt does not block its day', async () => {
  const { c, plan } = await mk(14)
  const m = await prisma.autoDebitMandate.create({
    data: { customerId: c.id, savingsPlanId: plan.id, authorizationCode: `AUTH_${rid}`, authSignature: 'sig', authEmail: 'a@b.c', status: 'active', amountPerCycle: 100, nextRunAt: new Date(Date.now() + DAY) },
  })
  mandateIds.push(m.id)
  await prisma.autoDebitAttempt.create({
    data: { mandateId: m.id, savingsPlanId: plan.id, reference: `autodebit-${plan.id}-y`, cycleDate: new Date(), creditAmount: 100, grossCharged: 102, feeEstimate: 2, status: 'failed' },
  })
  const [today] = await slotsByState(plan.id, 'today')
  assert.equal((await call(c, plan.id, [today])).status, 200)
})

test('weekly: a charge in flight blocks the whole week slot it falls in', async () => {
  const { c, plan } = await mk(15, 'self', 'weekly')
  const m = await prisma.autoDebitMandate.create({
    data: { customerId: c.id, savingsPlanId: plan.id, authorizationCode: `AUTH_${rid}`, authSignature: 'sig', authEmail: 'a@b.c', status: 'active', amountPerCycle: 100, nextRunAt: new Date(Date.now() + DAY) },
  })
  mandateIds.push(m.id)
  await prisma.autoDebitAttempt.create({
    data: { mandateId: m.id, savingsPlanId: plan.id, reference: `autodebit-${plan.id}-z`, cycleDate: new Date(), creditAmount: 100, grossCharged: 102, feeEstimate: 2, status: 'processing' },
  })
  // The plan started 10 days ago, so "today" is the 2nd week slot, keyed 3 days back.
  const [week] = await slotsByState(plan.id, 'today')
  assert.notEqual(week, watKey(new Date()))
  assert.equal((await call(c, plan.id, [week])).status, 409)
})

test('already-saved key: 400', async () => {
  const { c, plan } = await mk(5)
  const missed = await missedKeys(plan.id)
  const savedDay = missed[0]
  // stamp a deposit on that day so it is no longer missed
  await prisma.transaction.create({
    data: { ref: `CUI-dep-${rid}-5`, agentId, customerId: c.id, planId: plan.id, type: 'saving', amount: 100, status: 'Done', createdAt: new Date(savedDay + 'T10:00:00+01:00') },
  })
  assert.equal((await call(c, plan.id, [savedDay])).status, 400)
})

test('empty keys: 400', async () => {
  const { c, plan } = await mk(6)
  assert.equal((await call(c, plan.id, [])).status, 400)
})

test('>90 keys: 400', async () => {
  const { c, plan } = await mk(7)
  const keys = Array.from({ length: 91 }, (_, i) => watKey(new Date(Date.now() - (i + 1) * DAY)))
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

test('a plan started 00:30 WAT: keys are WAT days whatever the server timezone', async () => {
  const { c, plan } = await mk(16)
  // 23:30 UTC is 00:30 WAT the next day: under TZ=UTC, process-local slots would be a day behind the phone.
  const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - 3, 23, 30))
  await prisma.savingsPlan.update({ where: { id: plan.id }, data: { startDate: start } })
  const first = watKey(start)
  const { status, body } = await call(c, plan.id, [first])
  assert.equal(status, 200, body.error)
  // The UTC day before it is not a slot.
  const dayBefore = new Date(start.getTime() - 3_600_000).toISOString().slice(0, 10)
  assert.notEqual(dayBefore, first)
  assert.equal((await call(c, plan.id, [dayBefore])).status, 400)
})
