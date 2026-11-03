// What a customer sees when they come back from Paystack, how a checkout is started, and how money that can't be
// credited is recorded. Paystack is stubbed, so nothing leaves the machine.
process.env.PAYSTACK_SECRET_KEY = 'sk_live_return_not_real'
process.env.PAYSTACK_WEBHOOK_SECRET = 'whsec_return'
process.env.NEXTAUTH_URL = 'http://localhost:3000'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import { POST as webhook } from '../src/app/api/webhooks/paystack/route'
import { watKey } from '../src/lib/savings-card'

const rid = Math.random().toString(36).slice(2, 8)
const DAY = 864e5
let agentDbId = ''
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

// What the stubbed Paystack says. verify: status per reference. initialize: how it behaves, with a hook that runs when called.
const verifyStatus = new Map<string, { status: string; kobo: number }>()
let initMode: 'ok' | 'refuse' | 'down' = 'ok'
let onInit: (() => Promise<void>) | null = null
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url.toString()
  if (u.includes('/transaction/initialize')) {
    await onInit?.()
    if (initMode === 'down') throw new Error('network down')
    if (initMode === 'refuse') return new Response(JSON.stringify({ status: false, message: 'Invalid amount' }), { status: 400 })
    const sent = JSON.parse(String(init?.body ?? '{}'))
    return new Response(JSON.stringify({ status: true, data: { reference: sent.reference, authorization_url: 'https://checkout.paystack.test/x' } }), { status: 200 })
  }
  const m = u.match(/\/transaction\/verify\/([^/?]+)/)
  if (m) {
    const s = verifyStatus.get(decodeURIComponent(m[1]))
    if (!s) return new Response(JSON.stringify({ status: false, message: 'Transaction reference not found.' }), { status: 404 })
    return new Response(JSON.stringify({ status: true, data: { status: s.status, amount: s.kobo, currency: 'NGN', channel: 'bank_transfer' } }), { status: 200 })
  }
  return realFetch(url as never, init)
}) as typeof fetch

async function mk() {
  n++
  const c = await prisma.customer.create({
    data: { customerId: `PRT-${rid}-${n}`, agentId: agentDbId, firstName: 'C', lastName: 'X', phone: `08${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 1000, periodDays: 90, cadence: 'daily', goal: 'x', startDate: new Date(Date.now() - DAY), maturityDate: new Date(Date.now() + 89 * DAY), balance: 0, status: 'Active', source: 'self' },
  })
  planIds.push(plan.id)
  return { c, plan }
}
const signIn = async (c: { id: string; customerId: string }) => {
  const { signCustomerToken } = await import('../src/lib/customer-auth')
  currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId: agentDbId })
}
const post = (path: string, body: object) => new NextRequest(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) })

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `PRT-${rid}`, phone: `0792${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentDbId = a.id
})

after(async () => {
  await prisma.planDayCoverage.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.customerPayment.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.transaction.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.paymentIntent.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.agentReward.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: agentDbId } })
  globalThis.fetch = realFetch
  await prisma.$disconnect()
})

// --- coming back from Paystack ---------------------------------------------------------------------------------

async function startedPayment(c: { id: string }, planId: string) {
  const ref = `VCHS-CST-${rid}-${++n}`
  await prisma.paymentIntent.create({ data: { ref, actorType: 'customer', customerId: c.id, planId, amount: 1000 } })
  return ref
}
async function verify(c: { id: string; customerId: string }, reference: string) {
  await signIn(c)
  const { POST } = await import('../src/app/api/customer/paystack/verify/route')
  const res = await POST(post('/api/customer/paystack/verify', { reference }))
  return { status: res.status, body: JSON.parse(await res.text()) as Record<string, unknown> }
}

test('a bank transfer still on its way says pending, credits nothing, and leaves the intent for the webhook', async () => {
  for (const status of ['pending', 'ongoing', 'processing', 'queued']) {
    const { c, plan } = await mk()
    const ref = await startedPayment(c, plan.id)
    verifyStatus.set(ref, { status, kobo: 100000 })
    const v = await verify(c, ref)
    assert.equal(v.status, 200, status)
    assert.equal(v.body.pending, true, status)
    assert.equal(await prisma.transaction.count({ where: { ref } }), 0)
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref } })).status, 'Pending')
  }
})

test('a payment Paystack says failed or abandoned is still reported as not successful', async () => {
  for (const status of ['failed', 'abandoned']) {
    const { c, plan } = await mk()
    const ref = await startedPayment(c, plan.id)
    verifyStatus.set(ref, { status, kobo: 100000 })
    const v = await verify(c, ref)
    assert.equal(v.status, 400, status)
    assert.equal(v.body.pending, undefined, status)
  }
})

test('after it lands, the webhook credits the payment the customer was told was pending, once', async () => {
  const { c, plan } = await mk()
  const ref = await startedPayment(c, plan.id)
  verifyStatus.set(ref, { status: 'pending', kobo: 100000 })
  assert.equal((await verify(c, ref)).body.pending, true)
  verifyStatus.set(ref, { status: 'success', kobo: 100000 })
  const body = JSON.stringify({ event: 'charge.success', data: { reference: ref, status: 'success', amount: 100000, currency: 'NGN', channel: 'bank_transfer', metadata: {} } })
  const sig = crypto.createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET as string).update(body).digest('hex')
  const send = () => webhook({ text: async () => body, headers: new Headers({ 'x-paystack-signature': sig }) } as unknown as Parameters<typeof webhook>[0])
  assert.equal((await send()).status, 200)
  assert.equal((await send()).status, 200)
  assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: plan.id } })).balance, 1000)
  assert.equal((await verify(c, ref)).body.alreadyProcessed, true)
})

// --- starting a checkout ---------------------------------------------------------------------------------------

const tomorrow = () => watKey(new Date(Date.now() + DAY))
const checkouts = [
  { name: 'save', path: '/api/customer/paystack/init', route: '../src/app/api/customer/paystack/init/route', body: (planId: string) => ({ planId, amount: 1000 }) },
  { name: 'bulk savings', path: '/api/customer/catchup/init', route: '../src/app/api/customer/catchup/init/route', body: (planId: string) => ({ planId, keys: [tomorrow()] }) },
]

for (const co of checkouts) {
  test(`${co.name}: the intent exists before Paystack is called, and stays once it accepts`, async () => {
    const { c, plan } = await mk()
    await signIn(c)
    let intentsWhenCalled = -1
    initMode = 'ok'
    onInit = async () => { intentsWhenCalled = await prisma.paymentIntent.count({ where: { planId: plan.id } }) }
    try {
      const { POST } = await import(co.route)
      const res = await POST(post(co.path, co.body(plan.id)))
      assert.equal(res.status, 200)
    } finally { onInit = null }
    assert.equal(intentsWhenCalled, 1, 'written first, so a webhook that beats the response still finds it')
    assert.equal(await prisma.paymentIntent.count({ where: { planId: plan.id, status: 'Pending' } }), 1)
  })

  for (const mode of ['refuse', 'down'] as const) {
    test(`${co.name}: if Paystack ${mode === 'refuse' ? 'refuses' : 'cannot be reached'} the checkout answers 502 and leaves no intent behind`, async () => {
      const { c, plan } = await mk()
      await signIn(c)
      initMode = mode
      try {
        const { POST } = await import(co.route)
        const res = await POST(post(co.path, co.body(plan.id)))
        assert.equal(res.status, 502)
      } finally { initMode = 'ok' }
      assert.equal(await prisma.paymentIntent.count({ where: { planId: plan.id } }), 0)
    })
  }
}

// --- money that can't be credited must be recorded --------------------------------------------------------------

function charge(reference: string, kobo: number, metadata: object) {
  const body = JSON.stringify({ event: 'charge.success', data: { reference, status: 'success', amount: kobo, currency: 'NGN', channel: 'card', metadata } })
  const sig = crypto.createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET as string).update(body).digest('hex')
  return { text: async () => body, headers: new Headers({ 'x-paystack-signature': sig }) } as unknown as Parameters<typeof webhook>[0]
}

async function withFailingReviewWrites<T>(fn: () => Promise<T>): Promise<T> {
  const delegate = prisma.auditLog as unknown as { create: (a: unknown) => Promise<unknown> }
  const real = delegate.create
  delegate.create = (a: unknown) => {
    const action = (a as { data?: { action?: string } }).data?.action
    return action === 'payment_needs_manual_review' ? Promise.reject(new Error('database is locked')) : real.call(delegate, a)
  }
  try { return await fn() } finally { delegate.create = real }
}

test('a charge no checkout started: if its review record cannot be written the webhook errors, so Paystack redelivers', async () => {
  const { c, plan } = await mk()
  const ref = `STRAY-${rid}-${++n}`
  verifyStatus.set(ref, { status: 'success', kobo: 5000 })
  await withFailingReviewWrites(() => assert.rejects(() => webhook(charge(ref, 5000, { customerId: c.id, planId: plan.id }))))
  // Redelivered once the database is writable: recorded, and still not credited.
  assert.equal((await webhook(charge(ref, 5000, { customerId: c.id, planId: plan.id }))).status, 200)
  assert.equal(await prisma.auditLog.count({ where: { action: 'payment_needs_manual_review', details: { contains: ref } } }), 1)
  assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: plan.id } })).balance, 0)
})

test('a wallet charge no top-up started: same, an unwritable review record fails the request', async () => {
  const ref = `STRAYW-${rid}-${++n}`
  verifyStatus.set(ref, { status: 'success', kobo: 200000 })
  await withFailingReviewWrites(() => assert.rejects(() => webhook(charge(ref, 200000, { agentId: agentDbId }))))
  assert.equal((await webhook(charge(ref, 200000, { agentId: agentDbId }))).status, 200)
  assert.equal(await prisma.auditLog.count({ where: { action: 'payment_needs_manual_review', details: { contains: ref } } }), 1)
})
