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
import { settleIntentPayment } from '../src/lib/customer-settle'
import { buildSlots, buildSlotsWat, dayDeposits, watKey } from '../src/lib/savings-card'

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
const currencyByRef = new Map<string, string>()
const duringVerify = new Map<string, () => Promise<void>>()
const statusByRef = new Map<string, string>()
let initProbe: (() => Promise<unknown>) | null = null
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url.toString()
  if (u.includes('/transaction/initialize')) {
    const sent = JSON.parse(String(init?.body ?? '{}'))
    if (initProbe) return new Response(JSON.stringify(await initProbe()), { status: 400 })
    return new Response(JSON.stringify({ status: true, data: { reference: sent.reference, authorization_url: 'https://checkout.paystack.test/x' } }), { status: 200 })
  }
  const m = u.match(/\/transaction\/verify\/([^/?]+)/)
  if (m) {
    const ref = decodeURIComponent(m[1])
    await duringVerify.get(ref)?.()
    const amount = koboByRef.get(ref)
    return new Response(JSON.stringify({ status: true, data: { status: statusByRef.get(ref) ?? 'success', amount, currency: currencyByRef.get(ref) ?? 'NGN', channel: 'card' } }), { status: 200 })
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

const auditFor = (action: string, ref: string) => prisma.auditLog.findFirst({ where: { action, details: { contains: ref } } })
const balanceOf = async (planId: string) => (await prisma.savingsPlan.findUniqueOrThrow({ where: { id: planId } })).balance

test("the intent's customer and plan win over Paystack metadata", async () => {
  const { c, plan } = await mk()
  const { c: other, plan: otherPlan } = await mk()
  const keys = tomorrowKeys()
  const ref = await mkIntent(c, plan.id, keys, 200)
  await sendWebhook(ref, { customerId: other.id, planId: otherPlan.id, kobo: 20000 })
  await assertCreditedOnce(plan.id, ref, 200, keys)
  assert.equal(await balanceOf(otherPlan.id), 0)
})

test('verify also credits the plan on the intent', async () => {
  const { c, plan } = await mk()
  const keys = tomorrowKeys()
  const ref = await mkIntent(c, plan.id, keys, 200)
  assert.equal((await sendVerify(c, ref)).status, 200)
  await assertCreditedOnce(plan.id, ref, 200, keys)
})

for (const [route, pay] of [
  ['webhook', (c: { id: string; customerId: string }, planId: string, ref: string, kobo: number, currency?: string) => sendWebhook(ref, { customerId: c.id, planId, kobo, currency })],
  ['verify', (c: { id: string; customerId: string }, _planId: string, ref: string, kobo: number, currency?: string) => {
    koboByRef.set(ref, kobo)
    if (currency) currencyByRef.set(ref, currency)
    return sendVerify(c, ref)
  }],
] as const) {
  test(`${route}: a wrong amount credits what arrived, buys no days, and is audited`, async () => {
    const { c, plan } = await mk()
    const ref = await mkIntent(c, plan.id, tomorrowKeys(), 200)
    await pay(c, plan.id, ref, 15000)
    assert.equal(await balanceOf(plan.id), 150)
    assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), 0)
    assert.ok(await auditFor('payment_amount_mismatch', ref))
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref } })).status, 'Done')
  })

  test(`${route}: a wrong currency is never credited and goes to manual review`, async () => {
    const { c, plan } = await mk()
    const ref = await mkIntent(c, plan.id, tomorrowKeys(), 200)
    await pay(c, plan.id, ref, 20000, 'USD')
    assert.equal(await balanceOf(plan.id), 0)
    assert.equal(await prisma.transaction.count({ where: { ref } }), 0)
    assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), 0)
    assert.ok(await auditFor('payment_needs_manual_review', ref))
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref } })).status, 'Review')
  })

  test(`${route}: money for a closed plan is not credited and goes to manual review`, async () => {
    const { c, plan } = await mk()
    const ref = await mkIntent(c, plan.id, tomorrowKeys(), 200)
    await prisma.savingsPlan.update({ where: { id: plan.id }, data: { status: 'Redeemed' } })
    await pay(c, plan.id, ref, 20000)
    assert.equal(await balanceOf(plan.id), 0)
    assert.equal(await prisma.transaction.count({ where: { ref } }), 0)
    assert.ok(await auditFor('payment_needs_manual_review', ref))
  })
}

for (const [label, kobo] of [['zero', 0], ['missing', undefined]] as const) {
  test(`verify: a ${label} amount from Paystack credits nothing and goes to review, not ₦0`, async () => {
    const { c, plan } = await mk()
    const ref = await mkIntent(c, plan.id, tomorrowKeys(), 200)
    koboByRef.set(ref, kobo as number)
    const v = await sendVerify(c, ref)
    assert.equal(v.body.review, true)
    assert.equal(await prisma.transaction.count({ where: { ref } }), 0)
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref } })).status, 'Review')
  })
}

test('the customer sees a wrong amount bought no days, from verify and after the webhook', async () => {
  const direct = await mk()
  const keys = tomorrowKeys()
  const r1 = await mkIntent(direct.c, direct.plan.id, keys, 200)
  koboByRef.set(r1, 15000)
  const v1 = await sendVerify(direct.c, r1)
  assert.equal(v1.status, 200)
  assert.equal(v1.body.amount, 150)
  assert.deepEqual(v1.body.notBought, { count: 2, weekly: false, reason: 'amount' })

  const hook = await mk()
  const r2 = await mkIntent(hook.c, hook.plan.id, keys, 200)
  await sendWebhook(r2, { customerId: hook.c.id, planId: hook.plan.id, kobo: 15000 })
  const v2 = await sendVerify(hook.c, r2)
  assert.equal(v2.body.alreadyProcessed, true)
  assert.deepEqual(v2.body.notBought, { count: 2, weekly: false, reason: 'amount' })
})

test('verify tells the customer a payment is under review, whichever route found it', async () => {
  const { c, plan } = await mk()
  const ref = await mkIntent(c, plan.id, tomorrowKeys(), 200)
  await prisma.savingsPlan.update({ where: { id: plan.id }, data: { status: 'Redeemed' } })
  await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 })
  const v = await sendVerify(c, ref)
  assert.equal(v.status, 200)
  assert.equal(v.body.review, true)
  assert.equal(await prisma.auditLog.count({ where: { action: 'payment_needs_manual_review', details: { contains: ref } } }), 1, 'flagged once')
})

test('a webhook with no intent and no active plan is audited, not dropped silently', async () => {
  const { c, plan } = await mk()
  await prisma.savingsPlan.update({ where: { id: plan.id }, data: { status: 'Redeemed' } })
  const ref = `VCHS-CST-${rid}-closed-${++n}`
  assert.equal((await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 })).status, 200)
  assert.equal(await prisma.transaction.count({ where: { ref } }), 0)
  assert.ok(await auditFor('payment_needs_manual_review', ref))
})

test('a webhook with no intent in another currency is not credited', async () => {
  const { c, plan } = await mk()
  const ref = `VCHS-CST-${rid}-usd-${++n}`
  await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000, currency: 'USD' })
  assert.equal(await prisma.transaction.count({ where: { ref } }), 0)
  assert.ok(await auditFor('payment_needs_manual_review', ref))
})

test('two deliveries of a webhook with no intent at once credit once', async () => {
  const { c, plan } = await mk()
  const ref = `VCHS-CST-${rid}-race-${++n}`
  const results = await Promise.all([
    sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 }),
    sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 }),
  ])
  for (const r of results) assert.equal(r.status, 200)
  assert.equal(await prisma.transaction.count({ where: { ref } }), 1)
  assert.equal(await balanceOf(plan.id), 200)
})

test('a webhook whose credit collides with a ref that has no transaction rethrows, so Paystack retries', async () => {
  const { c, plan } = await mk()
  const ref = `VCHS-CST-${rid}-collide-${++n}`
  await prisma.customerPayment.create({ data: { ref: `PAY-${ref}`, customerId: c.id, planId: plan.id, amount: 1, status: 'Done', channel: 'card' } })
  await assert.rejects(() => sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 }))
  assert.equal(await balanceOf(plan.id), 0)
  assert.equal(await prisma.transaction.count({ where: { ref } }), 0)
})

test('a webhook that loses the race to the same ref returns early, with no second audit or balance change', async () => {
  const { c, plan } = await mk()
  const ref = `VCHS-CST-${rid}-lost-${++n}`
  await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 })
  // Past the first check the row looks absent, as it does for the delivery that loses a real race.
  const delegate = prisma.transaction as unknown as { findUnique: (a: unknown) => Promise<unknown> }
  const real = delegate.findUnique
  let calls = 0
  delegate.findUnique = (a: unknown) => (++calls === 1 ? Promise.resolve(null) : real.call(delegate, a))
  try {
    assert.equal((await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 })).status, 200)
  } finally {
    delegate.findUnique = real
  }
  assert.equal(calls, 2, 'took the collision path')
  assert.equal(await balanceOf(plan.id), 200)
  assert.equal(await prisma.auditLog.count({ where: { action: 'customer_paystack_payment', details: { contains: ref } } }), 1)
})

test('a plan redeemed between the read and the credit takes no money: nothing partial, flagged for review', async () => {
  const { c, plan } = await mk()
  const ref = await mkIntent(c, plan.id, tomorrowKeys(), 200)
  const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { ref } })
  // settleIntentPayment reads the plan, counts earlier savings, then credits: redeem it in between.
  const racing = new Proxy(prisma, {
    get(target, key) {
      if (key !== 'transaction') return Reflect.get(target, key)
      return { count: async () => { await prisma.savingsPlan.update({ where: { id: plan.id }, data: { status: 'Redeemed' } }); return 0 } }
    },
  })
  const r = await settleIntentPayment(racing, { intent, reference: ref, amountNaira: 200, currency: 'NGN', via: 'Paystack webhook' })
  assert.deepEqual(r, { kind: 'review' })
  assert.equal(await balanceOf(plan.id), 0)
  assert.equal(await prisma.transaction.count({ where: { ref } }), 0)
  assert.equal(await prisma.customerPayment.count({ where: { ref: `PAY-${ref}` } }), 0)
  assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), 0)
  assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref } })).status, 'Review')
  assert.ok(await auditFor('payment_needs_manual_review', ref))
})

test('a Matured plan can still be collected from, so it is credited', async () => {
  const { c, plan } = await mk()
  const ref = await mkIntent(c, plan.id, null, 200)
  await prisma.savingsPlan.update({ where: { id: plan.id }, data: { status: 'Matured' } })
  assert.equal((await sendVerify(c, ref)).status, 200)
  assert.equal(await balanceOf(plan.id), 200)
})

test('any other status goes to review, not where nobody can collect it', async () => {
  for (const status of ['Completed', 'SomethingNew']) {
    const viaVerify = await mk()
    const r1 = await mkIntent(viaVerify.c, viaVerify.plan.id, null, 200)
    await prisma.savingsPlan.update({ where: { id: viaVerify.plan.id }, data: { status } })
    assert.equal((await sendVerify(viaVerify.c, r1)).body.review, true)
    assert.equal(await balanceOf(viaVerify.plan.id), 0)

    const noIntent = await mk()
    const r2 = `VCHS-CST-${rid}-status-${++n}`
    await prisma.savingsPlan.update({ where: { id: noIntent.plan.id }, data: { status } })
    await sendWebhook(r2, { customerId: noIntent.c.id, planId: noIntent.plan.id, kobo: 20000 })
    assert.equal(await balanceOf(noIntent.plan.id), 0)
    assert.ok(await auditFor('payment_needs_manual_review', r2))
  }
})

test('a webhook review row that cannot be written fails the request, so Paystack retries', async () => {
  const { c, plan } = await mk()
  await prisma.savingsPlan.update({ where: { id: plan.id }, data: { status: 'Redeemed' } })
  const delegate = prisma.auditLog as unknown as { create: (a: unknown) => Promise<unknown> }
  const real = delegate.create
  delegate.create = (a: unknown) => {
    const data = (a as { data?: { action?: string } }).data
    return data?.action === 'payment_needs_manual_review' ? Promise.reject(new Error('database is locked')) : real.call(delegate, a)
  }
  try {
    await assert.rejects(() => sendWebhook(`VCHS-CST-${rid}-noaudit-${++n}`, { customerId: c.id, planId: plan.id, kobo: 20000 }))
  } finally {
    delegate.create = real
  }
})

test('an enrollment first payment is left to its verify route, so the mandate gets made', async () => {
  const { c, plan } = await mk()
  const ref = `addenroll-${plan.id}-${rid}-${++n}`
  await prisma.paymentIntent.create({ data: { ref, actorType: 'customer', customerId: c.id, planId: plan.id, amount: 50 } })
  assert.equal((await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 5000 })).status, 200)
  assert.equal(await prisma.transaction.count({ where: { ref } }), 0)
  assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref } })).status, 'Pending')
})

test('verify: a payment still pending at Paystack says so, not that it failed', async () => {
  const { c, plan } = await mk()
  const ref = await mkIntent(c, plan.id, null, 100)
  statusByRef.set(ref, 'pending')
  const v = await sendVerify(c, ref)
  assert.equal(v.status, 200)
  assert.equal(v.body.pending, true)
  assert.equal(await prisma.transaction.count({ where: { ref } }), 0)
  assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref } })).status, 'Pending')
})

test('verify: a failed payment is still a failure', async () => {
  const { c, plan } = await mk()
  const ref = await mkIntent(c, plan.id, null, 100)
  statusByRef.set(ref, 'failed')
  assert.equal((await sendVerify(c, ref)).status, 400)
})

test('/me: a lasting notice for a payment that bought no days, and one for a held payment', async () => {
  const { c, plan } = await mk()
  const key = tomorrowKey()
  await sendVerify(c, await mkIntent(c, plan.id, [key], 100))
  const second = await mkIntent(c, plan.id, [key], 100)
  await sendVerify(c, second)
  const wrong = await mkIntent(c, plan.id, [watKey(new Date(Date.now() + 5 * DAY))], 100)
  koboByRef.set(wrong, 5000)
  await sendVerify(c, wrong)
  const held = await mkIntent(c, plan.id, null, 300)
  await prisma.paymentIntent.update({ where: { ref: held }, data: { status: 'Review' } })

  const { signCustomerToken } = await import('../src/lib/customer-auth')
  currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId })
  const { GET } = await import('../src/app/api/customer/me/route')
  const me = await (await GET()).json() as { paymentNotices: { ref: string; count: number; reason: string; amount: number }[]; heldPayments: { ref: string; amount: number }[] }
  const byRef = new Map(me.paymentNotices.map(x => [x.ref, x]))
  assert.equal(byRef.size, 2)
  assert.deepEqual([byRef.get(second)?.count, byRef.get(second)?.reason, byRef.get(second)?.amount], [1, 'overlap', 100])
  assert.deepEqual([byRef.get(wrong)?.count, byRef.get(wrong)?.reason, byRef.get(wrong)?.amount], [1, 'amount', 50])
  assert.deepEqual(me.heldPayments.map(h => [h.ref, h.amount]), [[held, 300]])
})

test('/me: a part-paid online day stays payable at the full price, on phone and server alike', async () => {
  const { c, plan } = await mk()
  const ref = await mkIntent(c, plan.id, null, 40)
  await sendVerify(c, ref)
  const { phone, server } = await slotsBothWays(c, plan.id)
  for (const slots of [phone, server]) assert.equal(slots.find(s => s.key === todayKey())?.state, 'today')
  assert.equal(await sendInit(c, plan.id, [todayKey()]), 200)
  const intent = await prisma.paymentIntent.findFirstOrThrow({ where: { planId: plan.id, status: 'Pending' } })
  assert.equal(intent.amount, 100)
  assert.equal(await balanceOf(plan.id), 40)
})

test('init writes the intent before calling Paystack, and removes it if Paystack refuses', async () => {
  const { c, plan } = await mk()
  let intentsWhenCalled = -1
  initProbe = async () => { intentsWhenCalled = await prisma.paymentIntent.count({ where: { planId: plan.id } }); return { status: false, message: 'Nope' } }
  try {
    assert.equal(await sendInit(c, plan.id, [tomorrowKey()]), 502)
  } finally {
    initProbe = null
  }
  assert.equal(intentsWhenCalled, 1)
  assert.equal(await prisma.paymentIntent.count({ where: { planId: plan.id } }), 0)
})

test('verify: if the webhook wins during the Paystack fetch, it reports already processed', async () => {
  const { c, plan } = await mk()
  const keys = tomorrowKeys()
  const ref = await mkIntent(c, plan.id, keys, 200)
  duringVerify.set(ref, async () => { await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 20000 }) })
  const v = await sendVerify(c, ref)
  assert.equal(v.status, 200)
  assert.equal(v.body.alreadyProcessed, true)
  await assertCreditedOnce(plan.id, ref, 200, keys)
})

test('overlap: a second payment writes only the free days and audits the rest', async () => {
  const { c, plan } = await mk()
  const [day1, day2] = tomorrowKeys()
  const first = await mkIntent(c, plan.id, [day1], 100)
  const second = await mkIntent(c, plan.id, [day1, day2], 200)
  await sendVerify(c, first)
  const v = await sendVerify(c, second)
  assert.deepEqual(v.body.notBought, { count: 1, weekly: false, reason: 'overlap' })
  const cov = await prisma.planDayCoverage.findMany({ where: { savingsPlanId: plan.id } })
  assert.deepEqual(Object.fromEntries(cov.map(x => [x.coversKey, x.ref])), { [day1]: first, [day2]: second })
  const audit = await auditFor('payment_days_overlap', second)
  assert.ok(audit?.details?.includes(day1))
  assert.equal(await balanceOf(plan.id), 300, 'all the money is still saved')
})

test('backing out and starting again, then both checkouts getting paid: the day is bought once and all the money is kept', async () => {
  const { c, plan } = await mk()
  const key = tomorrowKey()
  assert.equal(await sendInit(c, plan.id, [key]), 200)
  assert.equal(await sendInit(c, plan.id, [key]), 200)
  const [older, newer] = await prisma.paymentIntent.findMany({ where: { planId: plan.id }, orderBy: { createdAt: 'asc' } })
  for (const i of [older, newer]) koboByRef.set(i.ref, 10000)
  assert.equal((await sendVerify(c, older.ref)).status, 200)
  const v = await sendVerify(c, newer.ref)
  assert.deepEqual(v.body.notBought, { count: 1, weekly: false, reason: 'overlap' })
  assert.equal(await balanceOf(plan.id), 200)
  assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), 1)
})

test('overlap: a payment that bought no days does not count as saved today', async () => {
  const { c, plan } = await mk()
  const key = tomorrowKey()
  await sendVerify(c, await mkIntent(c, plan.id, [key], 100))
  const second = await mkIntent(c, plan.id, [key], 100)
  const v = await sendVerify(c, second)
  assert.deepEqual(v.body.notBought, { count: 1, weekly: false, reason: 'overlap' })
  assert.equal(await prisma.planDayCoverage.count({ where: { ref: second } }), 0)
  const { phone, server } = await slotsBothWays(c, plan.id)
  for (const slots of [phone, server]) assert.equal(slots.find(s => s.key === todayKey())?.state, 'today')
  const m = await mandateFor(c, plan.id)
  assert.deepEqual(await runDueAutoDebits(prisma, new Date(), { mandateIds: [m.id] }), { charged: 1, skipped: 0, failed: 0, pending: 0 })
})

test('overlap: a day the card has since been charged for is not free', async () => {
  const { c, plan } = await mk()
  const m = await mandateFor(c, plan.id)
  await prisma.autoDebitMandate.update({ where: { id: m.id }, data: { nextRunAt: new Date(Date.now() + DAY) } })
  const key = todayKey()
  await prisma.autoDebitAttempt.create({
    data: { mandateId: m.id, savingsPlanId: plan.id, reference: `autodebit-${plan.id}-charged`, cycleDate: new Date(), creditAmount: 100, grossCharged: 102, feeEstimate: 2, status: 'success' },
  })
  const ref = await mkIntent(c, plan.id, [key], 100)
  const v = await sendVerify(c, ref)
  assert.deepEqual(v.body.notBought, { count: 1, weekly: false, reason: 'overlap' })
  assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), 0)
  assert.ok(await auditFor('payment_days_overlap', ref))
})

async function sendInit(c: { id: string; customerId: string }, planId: string, keys: string[]) {
  const { signCustomerToken } = await import('../src/lib/customer-auth')
  currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId })
  const { POST } = await import('../src/app/api/customer/catchup/init/route')
  const res = await POST(new NextRequest('http://localhost/api/customer/catchup/init', { method: 'POST', body: JSON.stringify({ planId, keys }) }))
  return res.status
}

type MePlan = { id: string; startDate: string; maturityDate: string; periodDays: number; cadence: string; coveredKeys: string[]; coveredRefs: string[] }
type MeTx = { ref: string; createdAt: string; planId: string; amount: number }

/** The slots both sides build: the phone from /api/customer/me, and the server as init does. */
async function slotsBothWays(c: { id: string; customerId: string }, planId: string) {
  const { signCustomerToken } = await import('../src/lib/customer-auth')
  currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId })
  const { GET } = await import('../src/app/api/customer/me/route')
  const me = await (await GET()).json() as { plans: MePlan[]; transactions: MeTx[] }
  const plan = me.plans.find(p => p.id === planId)!
  const dates = dayDeposits(me.transactions.filter(t => t.planId === planId), plan.coveredRefs).map(t => ({ createdAt: t.createdAt, amount: t.amount }))
  return { plan, phone: buildSlots(plan, dates, plan.coveredKeys), server: buildSlotsWat(plan, dates, plan.coveredKeys) }
}

async function mandateFor(c: { id: string }, planId: string) {
  return prisma.autoDebitMandate.create({
    data: { customerId: c.id, savingsPlanId: planId, authorizationCode: `AUTH_${rid}`, authSignature: 'sig', authEmail: 'a@b.c', status: 'active', amountPerCycle: 100, nextRunAt: new Date(Date.now() - 1000) },
  })
}

const todayKey = () => watKey(new Date())
const tomorrowKey = () => watKey(new Date(Date.now() + DAY))

for (const [order, pay] of [
  ['verify', (c: { id: string; customerId: string }, _planId: string, ref: string) => sendVerify(c, ref)],
  ['webhook', (c: { id: string; customerId: string }, planId: string, ref: string) => sendWebhook(ref, { customerId: c.id, planId, kobo: Number(koboByRef.get(ref)) })],
] as const) {
  test(`paid via ${order}, tomorrow only: today stays selectable and the cron charges today`, async () => {
    const { c, plan } = await mk()
    const ref = await mkIntent(c, plan.id, [tomorrowKey()], 100)
    await pay(c, plan.id, ref)

    const { phone, server } = await slotsBothWays(c, plan.id)
    for (const slots of [phone, server]) {
      assert.equal(slots.find(s => s.key === todayKey())?.state, 'today')
      assert.equal(slots.find(s => s.key === tomorrowKey())?.state, 'saved')
    }
    assert.equal(await sendInit(c, plan.id, [todayKey()]), 200)
    // That checkout would hold today; this test is about the cron with no checkout open.
    await prisma.paymentIntent.deleteMany({ where: { planId: plan.id, status: 'Pending' } })

    const m = await mandateFor(c, plan.id)
    const r = await runDueAutoDebits(prisma, new Date(), { mandateIds: [m.id] })
    assert.deepEqual(r, { charged: 1, skipped: 0, failed: 0, pending: 0 })
    assert.equal(await prisma.autoDebitAttempt.count({ where: { savingsPlanId: plan.id } }), 1)
  })

  test(`paid via ${order}, today and tomorrow: both saved, neither charged`, async () => {
    const { c, plan } = await mk()
    const keys = [todayKey(), tomorrowKey()]
    const ref = await mkIntent(c, plan.id, keys, 200)
    await pay(c, plan.id, ref)

    const { phone, server } = await slotsBothWays(c, plan.id)
    for (const slots of [phone, server]) {
      for (const key of keys) assert.equal(slots.find(s => s.key === key)?.state, 'saved')
    }
    assert.equal(await sendInit(c, plan.id, [todayKey()]), 400)

    const m = await mandateFor(c, plan.id)
    const scope = { mandateIds: [m.id] }
    assert.deepEqual(await runDueAutoDebits(prisma, new Date(), scope), { charged: 0, skipped: 1, failed: 0, pending: 0 })
    assert.deepEqual(await runDueAutoDebits(prisma, new Date(Date.now() + DAY), scope), { charged: 0, skipped: 1, failed: 0, pending: 0 })
    assert.equal(await prisma.autoDebitAttempt.count({ where: { savingsPlanId: plan.id } }), 0)
  })
}

test('a payment meant for days that bought none, on a wrong amount, does not count for the day it was stamped', async () => {
  const { c, plan } = await mk()
  const ref = await mkIntent(c, plan.id, [tomorrowKey()], 100)
  await sendWebhook(ref, { customerId: c.id, planId: plan.id, kobo: 5000 })
  const { phone, server } = await slotsBothWays(c, plan.id)
  for (const slots of [phone, server]) {
    assert.equal(slots.find(s => s.key === todayKey())?.state, 'today')
    assert.equal(slots.find(s => s.key === tomorrowKey())?.state, 'upcoming')
  }
})

test('a plain deposit with no days named still counts for the day it was stamped', async () => {
  const { c, plan } = await mk()
  await sendVerify(c, await mkIntent(c, plan.id, null, 100))
  const { phone, server } = await slotsBothWays(c, plan.id)
  for (const slots of [phone, server]) assert.equal(slots.find(s => s.key === todayKey())?.state, 'saved')
})

test('weekly, next week only: this week stays selectable', async () => {
  const { c, plan } = await mk()
  await prisma.savingsPlan.update({ where: { id: plan.id }, data: { cadence: 'weekly' } })
  const nextWeek = watKey(new Date(plan.startDate.getTime() + 7 * DAY))
  const thisWeek = watKey(plan.startDate)
  const ref = await mkIntent(c, plan.id, [nextWeek], 700)
  await sendVerify(c, ref)
  const { server, phone } = await slotsBothWays(c, plan.id)
  for (const slots of [phone, server]) {
    assert.equal(slots.find(s => s.key === thisWeek)?.state, 'today')
    assert.equal(slots.find(s => s.key === nextWeek)?.state, 'saved')
  }
  assert.equal(await sendInit(c, plan.id, [thisWeek]), 200)
})
