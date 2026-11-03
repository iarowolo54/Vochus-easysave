// Integration tests for the live Paystack webhook (api/webhooks/paystack): nothing is credited until Paystack
// itself confirms the charge, an agent wallet is funded only by a top-up this server started, payout outcomes
// are recorded, and an auto-funding signup ends with a mandate whichever route settles it first.
// A live-looking key makes the re-verify real; fetch is stubbed so nothing leaves the machine.
process.env.PAYSTACK_SECRET_KEY = 'sk_live_reverify_not_real'
process.env.PAYSTACK_WEBHOOK_SECRET = 'whsec_reverify'
process.env.NEXTAUTH_URL = 'http://localhost:3000'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import { POST as webhook } from '../src/app/api/webhooks/paystack/route'
import { POST as legacyWebhook } from '../src/app/api/paystack/webhook/route'
import { listedStatuses } from '../src/lib/receipt-payout'

const rid = Math.random().toString(36).slice(2, 8)
const DAY = 864e5
let agentDbId = ''
let n = 0
const customerIds: string[] = []
const planIds: string[] = []
const erIds: string[] = []
const refs: string[] = []

let currentToken = ''
const require_ = createRequire(import.meta.url)
const headersPath = require_.resolve('next/headers')
require_.cache[headersPath] = {
  id: headersPath, filename: headersPath, loaded: true, children: [], paths: [],
  exports: { cookies: async () => ({ get: (name: string) => (name === 'customer_token' && currentToken ? { name, value: currentToken } : undefined) }) },
} as unknown as NodeJS.Module

// What the stubbed Paystack says about each reference; absent means unreachable.
type Said = { status?: string; kobo?: number; currency?: string; reusable?: boolean }
const said = new Map<string, Said>()
let unreachable = false
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url.toString()
  const m = u.match(/\/transaction\/verify\/([^/?]+)/)
  if (m) {
    if (unreachable) throw new Error('network down')
    const ref = decodeURIComponent(m[1])
    const s = said.get(ref)
    if (!s) return new Response(JSON.stringify({ status: false, message: 'Transaction reference not found' }), { status: 404 })
    return new Response(JSON.stringify({
      status: true,
      data: {
        status: s.status ?? 'success', amount: s.kobo ?? 0, currency: s.currency ?? 'NGN', channel: 'card',
        ...(s.reusable ? { authorization: { authorization_code: 'AUTH_x', signature: 'SIG_x', reusable: true, last4: '4242', card_type: 'visa', bank: 'B', exp_month: '12', exp_year: '2030', channel: 'card' } } : {}),
      },
    }), { status: 200 })
  }
  return realFetch(url as never, init)
}) as typeof fetch

const ref = (prefix: string) => { const r = `${prefix}${rid}-${++n}`; refs.push(r); return r }

function send(body: object) {
  const text = JSON.stringify(body)
  const sig = crypto.createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET as string).update(text).digest('hex')
  return { text: async () => text, headers: new Headers({ 'x-paystack-signature': sig }) } as unknown as Parameters<typeof webhook>[0]
}
const charge = (reference: string, kobo: number, metadata: object = {}, currency = 'NGN') =>
  send({ event: 'charge.success', data: { reference, status: 'success', amount: kobo, currency, channel: 'card', metadata } })

async function mkCustomer(source = 'self') {
  n++
  const c = await prisma.customer.create({
    data: { customerId: `WRV-${rid}-${n}`, agentId: agentDbId, firstName: 'C', lastName: 'X', phone: `08${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 90, cadence: 'daily', goal: 'x', startDate: new Date(Date.now() - DAY), maturityDate: new Date(Date.now() + 89 * DAY), balance: 0, status: 'Active', source },
  })
  planIds.push(plan.id)
  return { c, plan }
}
const planBalance = async (id: string) => (await prisma.savingsPlan.findUniqueOrThrow({ where: { id } })).balance
const agentBalance = async () => (await prisma.agent.findUniqueOrThrow({ where: { id: agentDbId } })).walletBalance
const audits = (needle: string) => prisma.auditLog.count({ where: { details: { contains: needle } } })

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `WRV-${rid}`, phone: `0793${rid}`, name: 'A', location: 'x', password: 'x', walletBalance: 1000 } })
  agentDbId = a.id
})

after(async () => {
  await prisma.autoDebitMandate.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.customerPayment.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.transaction.deleteMany({ where: { OR: [{ planId: { in: planIds } }, { ref: { in: refs } }] } })
  await prisma.paymentIntent.deleteMany({ where: { ref: { in: refs } } })
  await prisma.earlyRedemption.deleteMany({ where: { id: { in: erIds } } })
  await prisma.agentReward.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: agentDbId } })
  globalThis.fetch = realFetch
  await prisma.$disconnect()
})

// --- re-verify before crediting -------------------------------------------------------------------------------

test('a signed charge Paystack does not confirm credits nothing and leaves the intent open', async () => {
  const { c, plan } = await mkCustomer()
  const r = ref('VCHS-CST-')
  await prisma.paymentIntent.create({ data: { ref: r, actorType: 'customer', customerId: c.id, planId: plan.id, amount: 100 } })
  said.set(r, { status: 'abandoned', kobo: 10000 })
  assert.equal((await webhook(charge(r, 10000, { customerId: c.id, planId: plan.id }))).status, 200)
  assert.equal(await planBalance(plan.id), 0)
  assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref: r } })).status, 'Pending')
  assert.equal(await audits(`ref ${r}`), 1, 'the refusal is recorded')
})

test('an amount Paystack disagrees with is sent to review, never credited', async () => {
  const { c, plan } = await mkCustomer()
  const r = ref('VCHS-CST-')
  await prisma.paymentIntent.create({ data: { ref: r, actorType: 'customer', customerId: c.id, planId: plan.id, amount: 100 } })
  said.set(r, { kobo: 100 }) // Paystack: ₦1, the webhook claims ₦100
  assert.equal((await webhook(charge(r, 10000, { customerId: c.id, planId: plan.id }))).status, 200)
  assert.equal(await planBalance(plan.id), 0)
  assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref: r } })).status, 'Review')
})

test('when Paystack cannot be reached the webhook answers 5xx, credits nothing, and the redelivery credits once', async () => {
  const { c, plan } = await mkCustomer()
  const r = ref('VCHS-CST-')
  await prisma.paymentIntent.create({ data: { ref: r, actorType: 'customer', customerId: c.id, planId: plan.id, amount: 100 } })
  said.set(r, { kobo: 10000 })
  unreachable = true
  assert.equal((await webhook(charge(r, 10000))).status, 502)
  unreachable = false
  assert.equal(await planBalance(plan.id), 0)
  assert.equal((await webhook(charge(r, 10000))).status, 200)
  assert.equal((await webhook(charge(r, 10000))).status, 200)
  assert.equal(await planBalance(plan.id), 100, 'credited once')
})

test('a customer charge with no intent is never credited, even when Paystack confirms it, and earns no reward', async () => {
  const { c, plan } = await mkCustomer()
  const r = ref('NOINTENT-')
  said.set(r, { kobo: 5000 })
  assert.equal((await webhook(charge(r, 5000, { customerId: c.id, planId: plan.id }))).status, 200)
  assert.equal(await planBalance(plan.id), 0)
  assert.equal(await prisma.transaction.count({ where: { ref: r } }), 0)
  assert.equal(await prisma.agentReward.count({ where: { customerId: c.id } }), 0, 'no registration reward')
  assert.equal(await audits(`ref ${r}`), 1, 'recorded for staff to review')
})

// --- agent wallet funding -------------------------------------------------------------------------------------

test('a wallet charge with no top-up behind it is audited for review and funds nothing', async () => {
  const r = ref('WLT-')
  said.set(r, { kobo: 500000 })
  const before_ = await agentBalance()
  assert.equal((await webhook(charge(r, 500000, { agentId: agentDbId }))).status, 200)
  assert.equal(await agentBalance(), before_)
  assert.equal(await prisma.transaction.count({ where: { ref: r } }), 0)
  assert.equal(await audits(`ref ${r}`), 1)
})

test('a started top-up credits the intent\'s agent once, with a walletAfter that matches the balance', async () => {
  const r = ref('WLT-')
  await prisma.paymentIntent.create({ data: { ref: r, actorType: 'agent', agentId: agentDbId, amount: 2000 } })
  said.set(r, { kobo: 200000 })
  const start = await agentBalance()
  // The charge's metadata names no one: the intent decides whose wallet.
  assert.equal((await webhook(charge(r, 200000))).status, 200)
  assert.equal((await webhook(charge(r, 200000))).status, 200)
  assert.equal(await agentBalance(), start + 2000, 'credited once')
  const t = await prisma.transaction.findUniqueOrThrow({ where: { ref: r } })
  assert.equal(t.walletAfter, start + 2000)
  assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref: r } })).status, 'Done')
})

test('a top-up paid for a different amount than was started goes to review, not the wallet', async () => {
  const r = ref('WLT-')
  await prisma.paymentIntent.create({ data: { ref: r, actorType: 'agent', agentId: agentDbId, amount: 2000 } })
  said.set(r, { kobo: 900000 })
  const start = await agentBalance()
  await webhook(charge(r, 900000))
  assert.equal(await agentBalance(), start)
  assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref: r } })).status, 'Review')
})

test('an agent top-up cannot be diverted to a customer plan by metadata naming a customer', async () => {
  const { c, plan } = await mkCustomer()
  const r = ref('WLT-')
  await prisma.paymentIntent.create({ data: { ref: r, actorType: 'agent', agentId: agentDbId, amount: 2000 } })
  said.set(r, { kobo: 200000 })
  const start = await agentBalance()
  await webhook(charge(r, 200000, { customerId: c.id, planId: plan.id }))
  assert.equal(await planBalance(plan.id), 0, 'the customer plan is untouched')
  assert.equal(await agentBalance(), start + 2000, 'the intent decided: the agent wallet got it')
})

// --- payout outcomes ------------------------------------------------------------------------------------------

async function mkPayout(code: string | null, method = 'Bank Transfer', status = 'pending') {
  const { plan } = await mkCustomer()
  const r = ref('RED-')
  const er = await prisma.earlyRedemption.create({
    data: { ref: r, savingsPlanId: plan.id, reason: 'x', status: 'Processing', balance: 1000, penalty: 100, netPayout: 900, payoutMethod: method, accountNumber: '0123456789', bankCode: '001', accountName: 'T A', paystackTransferCode: code, bankTransferStatus: status },
  })
  erIds.push(er.id)
  return er
}
const transferEvent = (event: string, data: object) => send({ event, data })

test('the live webhook records transfer success, failure and reversal against the payout', async () => {
  for (const [event, expected] of [['transfer.success', 'success'], ['transfer.failed', 'failed'], ['transfer.reversed', 'reversed']] as const) {
    const er = await mkPayout(`TRF_${rid}-${event}`)
    assert.equal((await webhook(transferEvent(event, { transfer_code: `TRF_${rid}-${event}`, reference: er.ref, amount: 90000, currency: 'NGN' }))).status, 200)
    assert.equal((await prisma.earlyRedemption.findUniqueOrThrow({ where: { id: er.id } })).bankTransferStatus, expected)
  }
})

test('a success can later be reversed, and the same event twice is harmless', async () => {
  const er = await mkPayout(`TRF_${rid}-sr`)
  const send_ = (event: string) => webhook(transferEvent(event, { transfer_code: `TRF_${rid}-sr`, reference: er.ref }))
  await send_('transfer.success')
  await send_('transfer.success')
  await send_('transfer.reversed')
  assert.equal((await prisma.earlyRedemption.findUniqueOrThrow({ where: { id: er.id } })).bankTransferStatus, 'reversed')
  assert.equal(await prisma.auditLog.count({ where: { action: 'paystack_transfer_status_conflict', entityId: er.id } }), 0, 'nothing was refused')
})

test('a late event never replaces a final, reversed or hand-recorded status, and the conflict is audited for staff', async () => {
  for (const held of ['failed', 'reversed', 'manual', 'blocked']) {
    const er = await mkPayout(`TRF_${rid}-late-${held}`, 'Bank Transfer', held)
    await webhook(transferEvent('transfer.success', { transfer_code: `TRF_${rid}-late-${held}`, reference: er.ref }))
    assert.equal((await prisma.earlyRedemption.findUniqueOrThrow({ where: { id: er.id } })).bankTransferStatus, held, `success must not replace ${held}`)
    assert.equal(await prisma.auditLog.count({ where: { action: 'paystack_transfer_status_conflict', entityId: er.id } }), 1, `${held} conflict audited`)
  }
  const reversed = await mkPayout(`TRF_${rid}-late-failed2`, 'Bank Transfer', 'reversed')
  await webhook(transferEvent('transfer.failed', { transfer_code: `TRF_${rid}-late-failed2`, reference: reversed.ref }))
  assert.equal((await prisma.earlyRedemption.findUniqueOrThrow({ where: { id: reversed.id } })).bankTransferStatus, 'reversed', 'failed must not replace reversed')
})

test('a success event moves a payout still pending', async () => {
  for (const held of ['pending', 'otp', 'received']) {
    const er = await mkPayout(`TRF_${rid}-open-${held}`, 'Bank Transfer', held)
    await webhook(transferEvent('transfer.success', { transfer_code: `TRF_${rid}-open-${held}`, reference: er.ref }))
    assert.equal((await prisma.earlyRedemption.findUniqueOrThrow({ where: { id: er.id } })).bankTransferStatus, 'success', held)
  }
})

test('a transfer event with no code and no reference changes nothing', async () => {
  const er = await mkPayout(null)
  assert.equal((await webhook(transferEvent('transfer.success', {}))).status, 200)
  assert.equal((await prisma.earlyRedemption.findUniqueOrThrow({ where: { id: er.id } })).bankTransferStatus, 'pending')
})

test('the other handler records transfers the same way', async () => {
  const er = await mkPayout(`TRF_${rid}b`)
  await legacyWebhook(transferEvent('transfer.failed', { transfer_code: `TRF_${rid}b`, reference: er.ref }) as unknown as Parameters<typeof legacyWebhook>[0])
  assert.equal((await prisma.earlyRedemption.findUniqueOrThrow({ where: { id: er.id } })).bankTransferStatus, 'failed')
})

test('lists show a bank payout as Processing until confirmed, Failed when Paystack gave up, Completed once paid', async () => {
  const pending = await mkPayout(`TRF_${rid}c`, 'Bank Transfer', 'pending')
  const blocked = await mkPayout(`TRF_${rid}d`, 'Bank Transfer', 'blocked')
  const paid = await mkPayout(`TRF_${rid}e`, 'Bank Transfer', 'success')
  const rows = [pending, blocked, paid].map((er, i) => ({ id: `row${i}`, type: 'redemption', ref: er.ref, method: 'Bank Transfer', status: 'Done' }))
  const got = await listedStatuses([...rows, { id: 'saving', type: 'saving', ref: 'TXN-1', method: 'Cash', status: 'Done' }])
  assert.equal(got.get('row0'), 'Processing')
  assert.equal(got.get('row1'), 'Failed')
  assert.equal(got.get('row2'), 'Completed')
  assert.equal(got.get('saving'), 'Done', 'other rows are untouched')
})

// --- auto-funding signup race ---------------------------------------------------------------------------------

async function enrolmentIntent() {
  const { c, plan } = await mkCustomer()
  const r = ref('addenroll-')
  await prisma.paymentIntent.create({ data: { ref: r, actorType: 'customer', customerId: c.id, planId: plan.id, amount: 100 } })
  said.set(r, { kobo: 10000, reusable: true })
  return { c, plan, r }
}

test('the webhook winning a signup saves the money AND creates the mandate', async () => {
  const { plan, r, c } = await enrolmentIntent()
  assert.equal((await webhook(charge(r, 10000, { customerId: c.id, planId: plan.id }))).status, 200)
  assert.equal(await planBalance(plan.id), 100)
  assert.equal(await prisma.autoDebitMandate.count({ where: { savingsPlanId: plan.id } }), 1)
})

test('the customer\'s verify callback after the webhook reports the mandate active', async () => {
  const { plan, r, c } = await enrolmentIntent()
  await webhook(charge(r, 10000, { customerId: c.id, planId: plan.id }))
  const { signCustomerToken } = await import('../src/lib/customer-auth')
  currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId: agentDbId })
  const { POST } = await import('../src/app/api/customer/auto-debit/verify/route')
  const res = await POST(new NextRequest('http://localhost/api/customer/auto-debit/verify', { method: 'POST', body: JSON.stringify({ reference: r }) }))
  assert.deepEqual(JSON.parse(await res.text()), { alreadyProcessed: true, active: true })
  assert.equal(await planBalance(plan.id), 100, 'still credited once')
})

test('a redelivered signup webhook repairs a missing mandate but never revives a cancelled one', async () => {
  const { plan, r, c } = await enrolmentIntent()
  await webhook(charge(r, 10000, { customerId: c.id, planId: plan.id }))
  await prisma.autoDebitMandate.deleteMany({ where: { savingsPlanId: plan.id } })
  await webhook(charge(r, 10000, { customerId: c.id, planId: plan.id }))
  assert.equal(await prisma.autoDebitMandate.count({ where: { savingsPlanId: plan.id } }), 1, 'missing mandate repaired')

  await prisma.autoDebitMandate.updateMany({ where: { savingsPlanId: plan.id }, data: { status: 'cancelled' } })
  await webhook(charge(r, 10000, { customerId: c.id, planId: plan.id }))
  assert.equal((await prisma.autoDebitMandate.findUniqueOrThrow({ where: { savingsPlanId: plan.id } })).status, 'cancelled')
  assert.equal(await planBalance(plan.id), 100, 'and never credited twice')
})
