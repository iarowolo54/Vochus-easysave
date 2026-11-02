// Integration tests: a Bulk Savings payment must credit once and write coverage whichever of the
// webhook and the browser's verify callback arrives first.
process.env.PAYSTACK_SECRET_KEY = 'sk_test_payahead'
process.env.PAYSTACK_WEBHOOK_SECRET = 'whsec_test_payahead'
process.env.NEXTAUTH_URL = 'http://localhost:3000'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import { POST as webhook } from '../src/app/api/webhooks/paystack/route'
import { runDueAutoDebits } from '../src/lib/auto-debit-run'
import { watKey } from '../src/lib/savings-card'

const rid = Math.random().toString(36).slice(2, 8)
const DAY = 864e5
let agentId = ''
let n = 0
const customerIds: string[] = []
const planIds: string[] = []

let currentToken = ''
const require_ = createRequire(import.meta.url)
const headersPath = require_.resolve('next/headers')
require_.cache[headersPath] = {
  id: headersPath, filename: headersPath, loaded: true, children: [], paths: [],
  exports: { cookies: async () => ({ get: (name: string) => (name === 'customer_token' && currentToken ? { name, value: currentToken } : undefined) }) },
} as unknown as NodeJS.Module

const koboByRef = new Map<string, number>()
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url.toString()
  const m = u.match(/\/transaction\/verify\/([^/?]+)/)
  if (m) {
    const amount = koboByRef.get(decodeURIComponent(m[1])) ?? 0
    return new Response(JSON.stringify({ status: true, data: { status: 'success', amount, currency: 'NGN', channel: 'card' } }), { status: 200 })
  }
  return realFetch(url as never, init)
}) as typeof fetch

async function mk() {
  n++
  const c = await prisma.customer.create({
    data: { customerId: `PAW-${rid}-${n}`, agentId, firstName: 'C', lastName: 'X', phone: `08${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 90, cadence: 'daily', goal: 'x', startDate: new Date(Date.now() - DAY), maturityDate: new Date(Date.now() + 89 * DAY), balance: 0, status: 'Active', source: 'self' },
  })
  planIds.push(plan.id)
  return { c, plan }
}

const tomorrowKeys = () => [watKey(new Date(Date.now() + DAY)), watKey(new Date(Date.now() + 2 * DAY))]

async function mkIntent(c: { id: string }, planId: string, keys: string[] | null, amount: number) {
  const ref = `VCHS-CST-${rid}-${++n}`
  koboByRef.set(ref, Math.round(amount * 100))
  await prisma.paymentIntent.create({
    data: { ref, actorType: 'customer', customerId: c.id, planId, amount, coversKeys: keys ? JSON.stringify(keys) : null },
  })
  return ref
}

function sendWebhook(ref: string, opts: { customerId: string; planId: string; kobo: number; metaKeys?: string[]; currency?: string }) {
  const body = JSON.stringify({
    event: 'charge.success',
    data: {
      reference: ref, status: 'success', amount: opts.kobo, currency: opts.currency ?? 'NGN', channel: 'card',
      metadata: { customerId: opts.customerId, planId: opts.planId, ...(opts.metaKeys ? { coversKeys: opts.metaKeys } : {}) },
    },
  })
  const sig = crypto.createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET as string).update(body).digest('hex')
  return webhook({ text: async () => body, headers: new Headers({ 'x-paystack-signature': sig }) } as unknown as Parameters<typeof webhook>[0])
}

async function sendVerify(c: { id: string; customerId: string }, reference: string) {
  const { signCustomerToken } = await import('../src/lib/customer-auth')
  currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId })
  const { POST } = await import('../src/app/api/customer/paystack/verify/route')
  const res = await POST(new NextRequest('http://localhost/api/customer/paystack/verify', { method: 'POST', body: JSON.stringify({ reference }) }))
  return { status: res.status, body: JSON.parse(await res.text()) }
}

async function assertCreditedOnce(planId: string, ref: string, amount: number, keys: string[]) {
  assert.equal(await prisma.transaction.count({ where: { ref } }), 1, 'one credit')
  assert.equal(await prisma.customerPayment.count({ where: { ref: `PAY-${ref}` } }), 1, 'one payment row')
  assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: planId } })).balance, amount, 'balance credited once')
  const cov = await prisma.planDayCoverage.findMany({ where: { savingsPlanId: planId } })
  assert.deepEqual(cov.map(x => x.coversKey).sort(), [...keys].sort(), 'coverage written')
  assert.ok(cov.every(x => x.ref === ref))
  assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref } })).status, 'Done', 'intent consumed')
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `PAW-${rid}`, phone: `0795${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
})

after(async () => {
  await prisma.autoDebitAttempt.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.autoDebitMandate.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.planDayCoverage.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.customerPayment.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.transaction.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.paymentIntent.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  globalThis.fetch = realFetch
  await prisma.$disconnect()
})

test('webhook then verify: one credit, coverage written, verify reports alreadyProcessed', async () => {
  const { c, plan } = await mk()
  const keys = tomorrowKeys()
  const ref = await mkIntent(c, plan.id, keys, 200)
  assert.equal((await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 })).status, 200)
  await assertCreditedOnce(plan.id, ref, 200, keys)
  const v = await sendVerify(c, ref)
  assert.equal(v.status, 200)
  assert.equal(v.body.alreadyProcessed, true)
  await assertCreditedOnce(plan.id, ref, 200, keys)
})

test('verify then webhook: one credit, coverage written once', async () => {
  const { c, plan } = await mk()
  const keys = tomorrowKeys()
  const ref = await mkIntent(c, plan.id, keys, 200)
  assert.equal((await sendVerify(c, ref)).status, 200)
  await assertCreditedOnce(plan.id, ref, 200, keys)
  assert.equal((await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 })).status, 200)
  await assertCreditedOnce(plan.id, ref, 200, keys)
})

test('webhook twice: replay credits once', async () => {
  const { c, plan } = await mk()
  const keys = tomorrowKeys()
  const ref = await mkIntent(c, plan.id, keys, 200)
  await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 })
  await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 })
  await assertCreditedOnce(plan.id, ref, 200, keys)
})

test('webhook and verify at once: one credit whichever wins', async () => {
  const { c, plan } = await mk()
  const keys = tomorrowKeys()
  const ref = await mkIntent(c, plan.id, keys, 200)
  await Promise.all([sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 }), sendVerify(c, ref)])
  await assertCreditedOnce(plan.id, ref, 200, keys)
})

test('the day the webhook covered is not charged by auto-debit', async () => {
  const { c, plan } = await mk()
  const keys = tomorrowKeys()
  const ref = await mkIntent(c, plan.id, keys, 200)
  await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 })
  const m = await prisma.autoDebitMandate.create({
    data: { customerId: c.id, savingsPlanId: plan.id, authorizationCode: `AUTH_${rid}`, authSignature: 'sig', authEmail: 'a@b.c', status: 'active', amountPerCycle: 100, nextRunAt: new Date() },
  })
  const r = await runDueAutoDebits(prisma, new Date(Date.now() + DAY), { mandateIds: [m.id] })
  assert.deepEqual(r, { charged: 0, skipped: 1, failed: 0, pending: 0 })
  assert.equal(await prisma.autoDebitAttempt.count({ where: { savingsPlanId: plan.id } }), 0)
})

test('coverage comes from the intent, never from Paystack metadata', async () => {
  const { c, plan } = await mk()
  const keys = tomorrowKeys()
  const ref = await mkIntent(c, plan.id, keys, 200)
  await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000, metaKeys: ['2030-01-01', '2030-01-02', '2030-01-03'] })
  await assertCreditedOnce(plan.id, ref, 200, keys)
})

test('a metadata-only coversKeys with no intent writes no coverage, and still credits as before', async () => {
  const { c, plan } = await mk()
  const ref = `VCHS-CST-${rid}-nointent`
  await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000, metaKeys: tomorrowKeys() })
  assert.equal(await prisma.transaction.count({ where: { ref } }), 1)
  assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: plan.id } })).balance, 200)
  assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), 0)
})

test('a plain save intent (no keys) credits, consumes, and writes no coverage', async () => {
  const { c, plan } = await mk()
  const ref = await mkIntent(c, plan.id, null, 500)
  await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 50000 })
  assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: plan.id } })).balance, 500)
  assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), 0)
  assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref } })).status, 'Done')
})

test("another customer's intent is ignored: no coverage, and it stays pending", async () => {
  const { c, plan } = await mk()
  const { c: other, plan: otherPlan } = await mk()
  const ref = await mkIntent(other, otherPlan.id, tomorrowKeys(), 200)
  await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 })
  assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: { in: [plan.id, otherPlan.id] } } }), 0)
  assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref } })).status, 'Pending')
})

test('an amount that does not match the intent credits what was paid but buys no days', async () => {
  const { c, plan } = await mk()
  const ref = await mkIntent(c, plan.id, tomorrowKeys(), 200)
  await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 10000 })
  assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: plan.id } })).balance, 100)
  assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), 0)
})

test('a wrong currency buys no days', async () => {
  const { c, plan } = await mk()
  const ref = await mkIntent(c, plan.id, tomorrowKeys(), 200)
  await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000, currency: 'USD' })
  assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), 0)
})

test('an intent for a different plan writes no coverage on the credited plan', async () => {
  const { c, plan } = await mk()
  const second = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 90, cadence: 'daily', goal: 'y', startDate: new Date(), maturityDate: new Date(Date.now() + 90 * DAY), balance: 0, status: 'Active', source: 'self' },
  })
  planIds.push(second.id)
  const ref = await mkIntent(c, second.id, tomorrowKeys(), 200)
  await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 })
  assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: { in: [plan.id, second.id] } } }), 0)
})
