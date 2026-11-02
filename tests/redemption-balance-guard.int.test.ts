// Money arriving while a redemption is open must never be wiped by approving it. Real prisma; rows
// are scoped by a run id and removed by id. sk_test_ makes the paystack lib short-circuit.
process.env.PAYSTACK_SECRET_KEY = 'sk_test_balance_guard'
process.env.NEXTAUTH_URL = 'http://localhost:3000'
process.env.NEXTAUTH_SECRET ??= 'test-secret'
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import bcrypt from 'bcryptjs'

const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => null }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
let currentToken = ''
const require_ = createRequire(import.meta.url)
const headersPath = require_.resolve('next/headers')
require_.cache[headersPath] = {
  id: headersPath, filename: headersPath, loaded: true, children: [], paths: [],
  exports: { cookies: async () => ({ get: (n: string) => (n === 'customer_token' && currentToken ? { name: n, value: currentToken } : undefined) }) },
} as unknown as NodeJS.Module
let paystackInits = 0
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url.toString()
  if (u.includes('/transaction/initialize')) {
    paystackInits++
    const sent = JSON.parse(String(init?.body ?? '{}'))
    return new Response(JSON.stringify({ status: true, data: { reference: sent.reference, authorization_url: 'https://checkout.paystack.test/x' } }), { status: 200 })
  }
  return realFetch(url as never, init)
}) as typeof fetch
/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/lib/prisma') as typeof import('../src/lib/prisma')
const { signCustomerToken } = require('../src/lib/customer-auth') as typeof import('../src/lib/customer-auth')
const { BALANCE_CHANGED, closePlanAfterFinalize, hasOpenRedemption } = require('../src/lib/redemption-balance') as typeof import('../src/lib/redemption-balance')
const er = require('../src/app/api/admin/early-redemption/[id]/route') as typeof import('../src/app/api/admin/early-redemption/[id]/route')
const fin = require('../src/app/api/admin/early-redemption/[id]/finalize-otp/route') as typeof import('../src/app/api/admin/early-redemption/[id]/finalize-otp/route')
const saving = require('../src/app/api/transactions/saving/route') as typeof import('../src/app/api/transactions/saving/route')
const init = require('../src/app/api/customer/paystack/init/route') as typeof import('../src/app/api/customer/paystack/init/route')
const direct = require('../src/app/api/transactions/redemption/route') as typeof import('../src/app/api/transactions/redemption/route')
/* eslint-enable @typescript-eslint/no-require-imports */

const RUN = Math.random().toString(36).slice(2, 8)
const PIN = '482913'
let adminId = ''
let agentId = ''
let agentCode = ''
let customerId = ''
const planIds: string[] = []
const erIds: string[] = []
const refs: string[] = []
let revenueBefore: number | null = null
let modeBefore: string | null = null
const seq = { n: 0 }

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const approve = (id: string) => er.PATCH({ json: async () => ({ action: 'approve', pin: PIN }) } as never, ctx(id))
const reject = (id: string) => er.PATCH({ json: async () => ({ action: 'reject' }) } as never, ctx(id))
const finalize = (id: string) => fin.POST({ json: async () => ({ otp: '123456' }) } as never, ctx(id))
const save = (planId: string) => saving.POST({ json: async () => ({ customerId, amount: 100, method: 'Cash', planId }) } as never)
const payInit = (planId: string) => init.POST({ json: async () => ({ planId, amount: 500 }) } as never)
const revenue = async () => (await prisma.platformWallet.findUnique({ where: { type: 'Revenue' } }))?.balance ?? 0
const planRow = (id: string) => prisma.savingsPlan.findUniqueOrThrow({ where: { id } })
const erRow = (id: string) => prisma.earlyRedemption.findUniqueOrThrow({ where: { id } })
const asAdmin = () => { stub.getServerSession = async () => ({ user: { id: adminId, name: 'Guard Admin', role: 'superadmin' } }) }
const asAgent = () => { stub.getServerSession = async () => ({ user: { agentId: agentCode } }) }
const setMode = (customer: 'auto' | 'manual') => prisma.platformSetting.upsert({
  where: { key: 'payoutMode' }, update: { value: JSON.stringify({ customer }) }, create: { key: 'payoutMode', value: JSON.stringify({ customer }) },
})

async function mkPlan(balance: number, status = 'Active') {
  const p = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 1e10), balance, status, source: 'agent' },
  })
  planIds.push(p.id)
  return p.id
}
async function mkRedemption(opts: { planId: string; requested?: number; method?: string; status?: string; tokenExpiry?: Date | null; transferCode?: string }) {
  const ref = `RG-${RUN}-${seq.n++}`
  refs.push(ref)
  const r = await prisma.earlyRedemption.create({
    data: {
      ref, savingsPlanId: opts.planId, reason: 'x', status: opts.status ?? 'AgentApproved', balance: opts.requested ?? 10000, penalty: 500, netPayout: 9500,
      payoutMethod: opts.method ?? 'Cash', accountNumber: '0123456789', bankCode: '001', accountName: 'Test Account', bankName: 'Bank',
      tokenExpiry: opts.tokenExpiry ?? null, paystackTransferCode: opts.transferCode ?? null,
    },
  })
  erIds.push(r.id)
  return r
}
const money = async () => {
  const a = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } })
  return { wallet: a.walletBalance, commission: a.commissionBalance, revenue: await revenue() }
}
/** Refused, nothing moved, request still open, plan untouched. */
async function assertRefused(res: Response, r: { id: string; ref: string; status: string }, planId: string, balance: number, moneyBefore: Awaited<ReturnType<typeof money>>) {
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, BALANCE_CHANGED)
  const after = await erRow(r.id)
  assert.equal(after.status, r.status)
  assert.equal(after.paystackTransferCode, null, 'no transfer started')
  const plan = await planRow(planId)
  assert.equal(plan.balance, balance)
  assert.equal(plan.status, 'Active')
  assert.deepEqual(await money(), moneyBefore)
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 0)
}

before(async () => {
  adminId = (await prisma.superAdmin.create({ data: { email: `rg-${RUN}@test.local`, password: 'x', name: 'Guard Admin', approvalPin: await bcrypt.hash(PIN, 4) } })).id
  agentCode = `RG-${RUN}`
  agentId = (await prisma.agent.create({ data: { agentId: agentCode, phone: `0796${RUN}`, name: 'A', location: 'x', password: 'x', walletBalance: 1000000 } })).id
  customerId = (await prisma.customer.create({
    data: { customerId: `RG-${RUN}`, agentId, firstName: 'C', lastName: 'X', phone: `08${RUN}3`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })).id
  revenueBefore = (await prisma.platformWallet.findUnique({ where: { type: 'Revenue' } }))?.balance ?? null
  modeBefore = (await prisma.platformSetting.findUnique({ where: { key: 'payoutMode' } }))?.value ?? null
  await prisma.platformWallet.upsert({ where: { type: 'Revenue' }, update: {}, create: { type: 'Revenue', balance: 100000 } })
  currentToken = await signCustomerToken({ id: customerId, name: 'C X', customerId: `RG-${RUN}` } as never)
})

beforeEach(async () => {
  asAdmin()
  await setMode('auto')
  await prisma.approvalPinAttempt.deleteMany({ where: { adminId } })
})

after(async () => {
  M._load = realLoad
  globalThis.fetch = realFetch
  await prisma.transaction.deleteMany({ where: { OR: [{ agentId }, { ref: { in: refs } }] } })
  await prisma.paymentIntent.deleteMany({ where: { customerId } })
  await prisma.earlyRedemption.deleteMany({ where: { id: { in: erIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.approvalPinAttempt.deleteMany({ where: { adminId } })
  await prisma.superAdmin.deleteMany({ where: { id: adminId } })
  if (revenueBefore === null) await prisma.platformWallet.deleteMany({ where: { type: 'Revenue' } })
  else await prisma.platformWallet.update({ where: { type: 'Revenue' }, data: { balance: revenueBefore } })
  if (modeBefore === null) await prisma.platformSetting.deleteMany({ where: { key: 'payoutMode' } })
  else await prisma.platformSetting.update({ where: { key: 'payoutMode' }, data: { value: modeBefore } })
  await prisma.$disconnect()
})

// ---------- approval: balance matches, pays as today ----------
test('cash approve, balance unchanged: pays and closes the plan', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId })
  const m0 = await money()
  assert.equal((await approve(r.id)).status, 200)
  const plan = await planRow(planId)
  assert.equal(plan.balance, 0)
  assert.equal(plan.status, 'Redeemed')
  assert.equal((await erRow(r.id)).status, 'Approved')
  assert.equal((await money()).wallet, m0.wallet + 9500)
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 1)
})

test('bank approve, balance unchanged: starts the transfer and closes the plan', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, method: 'BankTransfer' })
  assert.equal((await approve(r.id)).status, 200)
  const row = await erRow(r.id)
  assert.equal(row.status, 'Approved')
  assert.ok(row.paystackTransferCode, 'transfer started')
  assert.equal((await planRow(planId)).balance, 0)
})

test('manual bank approve, balance unchanged: records the payout and closes the plan', async () => {
  await setMode('manual')
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, method: 'Bank Transfer' })
  assert.equal((await approve(r.id)).status, 200)
  assert.equal((await erRow(r.id)).bankTransferStatus, 'manual')
  assert.equal((await planRow(planId)).balance, 0)
})

test('a request stored rounded still matches a plan balance with float drift', async () => {
  const planId = await mkPlan(300.29999999999995)
  const r = await mkRedemption({ planId, requested: 300.3 })
  assert.equal((await approve(r.id)).status, 200)
  assert.equal((await planRow(planId)).balance, 0)
})

// ---------- approval: balance changed, nothing moves ----------
test('cash approve after a deposit is refused, and nothing moves', async () => {
  const planId = await mkPlan(55000)
  const r = await mkRedemption({ planId })
  await assertRefused(await approve(r.id), r, planId, 55000, await money())
})

test('bank approve after a deposit is refused before any transfer starts', async () => {
  const planId = await mkPlan(55000)
  const r = await mkRedemption({ planId, method: 'BankTransfer' })
  await assertRefused(await approve(r.id), r, planId, 55000, await money())
})

test('manual bank approve after a deposit is refused', async () => {
  await setMode('manual')
  const planId = await mkPlan(55000)
  const r = await mkRedemption({ planId, method: 'Bank Transfer' })
  await assertRefused(await approve(r.id), r, planId, 55000, await money())
})

test('a one-kobo change is still refused', async () => {
  const planId = await mkPlan(10000.01)
  const r = await mkRedemption({ planId })
  await assertRefused(await approve(r.id), r, planId, 10000.01, await money())
})

test('the plan-claim guards hold even if the balance changes after the first check', async () => {
  // A deposit between the route's read and its claim: drive the guard the claim relies on.
  const { claimPlanForPayout } = require('../src/lib/redemption-balance') as typeof import('../src/lib/redemption-balance') // eslint-disable-line @typescript-eslint/no-require-imports
  const planId = await mkPlan(55000)
  assert.equal(await claimPlanForPayout(prisma, planId, 10000), BALANCE_CHANGED)
  assert.equal((await planRow(planId)).balance, 55000)
  assert.equal((await planRow(planId)).status, 'Active')
  assert.equal(await claimPlanForPayout(prisma, planId, 55000), null)
  assert.equal((await planRow(planId)).balance, 0)
  assert.match((await claimPlanForPayout(prisma, planId, 55000))!, /already been redeemed/)
})

// ---------- reject ----------
test('reject after a deposit leaves the money and reopens the plan', async () => {
  for (const method of ['Cash', 'BankTransfer']) {
    const planId = await mkPlan(55000)
    const r = await mkRedemption({ planId, method })
    assert.equal((await approve(r.id)).status, 409)
    const m0 = await money()
    assert.equal((await reject(r.id)).status, 200)
    const plan = await planRow(planId)
    assert.equal(plan.balance, 55000)
    assert.equal(plan.status, 'Active')
    assert.equal((await erRow(r.id)).status, 'Rejected')
    assert.deepEqual(await money(), m0)
  }
})

// ---------- OTP finalize ----------
test('finalize: a pre-claimed plan (already 0) still completes', async () => {
  const planId = await mkPlan(0, 'Redeemed')
  const r = await mkRedemption({ planId, method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_a` })
  assert.equal((await finalize(r.id)).status, 200)
  assert.equal((await erRow(r.id)).status, 'Approved')
  assert.equal((await planRow(planId)).balance, 0)
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 1)
})

test('finalize: money landing while waiting for the code refuses BEFORE Paystack, and keeps it', async () => {
  const planId = await mkPlan(45000, 'Redeemed')
  const r = await mkRedemption({ planId, method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_b` })
  const m0 = await money()
  const res = await finalize(r.id)
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /Nothing has been paid/)
  assert.equal((await erRow(r.id)).status, 'AwaitingOTP', 'not claimed, so Paystack was never called')
  assert.equal((await planRow(planId)).balance, 45000)
  assert.deepEqual(await money(), m0)
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 0)
})

test('finalize: a deposit of exactly the requested amount on a pre-claimed plan is still refused', async () => {
  const planId = await mkPlan(10000, 'Redeemed')
  const r = await mkRedemption({ planId, method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_c` })
  const m0 = await money()
  assert.equal((await finalize(r.id)).status, 409)
  assert.equal((await erRow(r.id)).status, 'AwaitingOTP')
  assert.equal((await planRow(planId)).balance, 10000)
  assert.deepEqual(await money(), m0)
})

test('finalize: a record with no pre-claim (plan still open at the requested balance) completes', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_d` })
  assert.equal((await finalize(r.id)).status, 200)
  assert.equal((await planRow(planId)).balance, 0)
  assert.equal((await planRow(planId)).status, 'Redeemed')
})

test('finalize: an open plan with a different balance is refused', async () => {
  for (const balance of [0, 55000]) {
    const planId = await mkPlan(balance)
    const r = await mkRedemption({ planId, method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_e${balance}` })
    assert.equal((await finalize(r.id)).status, 409, String(balance))
    assert.equal((await planRow(planId)).balance, balance)
  }
})

test('closePlanAfterFinalize zeroes a settled plan but never a deposit', async () => {
  const preClaimed = await mkPlan(0, 'Redeemed')
  assert.equal(await closePlanAfterFinalize(prisma, preClaimed, 10000), true)
  const sameAmount = await mkPlan(10000, 'Redeemed')
  assert.equal(await closePlanAfterFinalize(prisma, sameAmount, 10000), false)
  assert.equal((await planRow(sameAmount)).balance, 10000)
  const legacy = await mkPlan(10000)
  assert.equal(await closePlanAfterFinalize(prisma, legacy, 10000), true)
  assert.equal((await planRow(legacy)).balance, 0)
  assert.equal((await planRow(legacy)).status, 'Redeemed')
  const deposited = await mkPlan(45000, 'Redeemed')
  assert.equal(await closePlanAfterFinalize(prisma, deposited, 10000), false)
  assert.equal((await planRow(deposited)).balance, 45000)
})

// ---------- the agent's direct path already guards on the balance it read ----------
test('agent direct redemption is refused while a request is open', async () => {
  const planId = await mkPlan(10000)
  await mkRedemption({ planId, status: 'Pending' })
  asAgent()
  const res = await direct.POST({ json: async () => ({ customerId, planId, method: 'Cash' }) } as never)
  assert.equal(res.status, 404)
  assert.equal((await planRow(planId)).balance, 10000)
})

// ---------- saving routes ----------
test('agent saving: 409 during each open status, nothing debited', async () => {
  for (const status of ['Pending', 'TokenValidated', 'AgentApproved', 'AwaitingOTP', 'Finalizing']) {
    const planId = await mkPlan(10000)
    await mkRedemption({ planId, status })
    asAgent()
    const m0 = await money()
    const res = await save(planId)
    assert.equal(res.status, 409, status)
    assert.match((await res.json()).error, /collect/i)
    assert.equal((await planRow(planId)).balance, 10000)
    assert.deepEqual(await money(), m0)
  }
})

test('agent saving works once the request closes', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, status: 'Pending' })
  assert.equal((await reject(r.id)).status, 200)
  asAgent()
  assert.equal((await save(planId)).status, 200)
  assert.equal((await planRow(planId)).balance, 10100)
})

test('agent saving works on a plan with no request', async () => {
  const planId = await mkPlan(10000)
  asAgent()
  assert.equal((await save(planId)).status, 200)
})

test('customer Paystack init: 409 during an open request, with no Paystack call', async () => {
  const planId = await mkPlan(10000)
  await mkRedemption({ planId, status: 'TokenValidated' })
  const before = paystackInits
  const res = await payInit(planId)
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /collect/i)
  assert.equal(paystackInits, before)
  assert.equal(await prisma.paymentIntent.count({ where: { customerId, planId } }), 0)
})

test('customer Paystack init works once the request closes', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, status: 'Pending' })
  assert.equal((await payInit(planId)).status, 409)
  assert.equal((await reject(r.id)).status, 200)
  assert.equal((await payInit(planId)).status, 200)
})

// ---------- what counts as open ----------
test('hasOpenRedemption: an abandoned code does not block saving, an unexpired or admin-made one does', async () => {
  const past = new Date(Date.now() - 60_000)
  const future = new Date(Date.now() + 60_000)
  const cases: [string, { status: string; tokenExpiry?: Date | null }, boolean][] = [
    ['Pending, code live', { status: 'Pending', tokenExpiry: future }, true],
    ['Pending, code expired', { status: 'Pending', tokenExpiry: past }, false],
    ['Pending, admin-created', { status: 'Pending', tokenExpiry: null }, true],
    ['TokenValidated, code expired', { status: 'TokenValidated', tokenExpiry: past }, true],
    ['AgentApproved, code expired', { status: 'AgentApproved', tokenExpiry: past }, true],
    ['Rejected', { status: 'Rejected' }, false],
    ['Approved', { status: 'Approved' }, false],
  ]
  for (const [label, opts, expected] of cases) {
    const planId = await mkPlan(10000)
    await mkRedemption({ planId, ...opts })
    assert.equal(await hasOpenRedemption(prisma, planId), expected, label)
  }
})

test('a deposit after an abandoned code is still caught by the approval guard', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, status: 'Pending', tokenExpiry: new Date(Date.now() - 60_000) })
  asAgent()
  assert.equal((await save(planId)).status, 200)
  asAdmin()
  const res = await approve(r.id)
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, BALANCE_CHANGED)
  assert.equal((await planRow(planId)).balance, 10100)
})

test('the refusal message is not mistaken for a PIN error on the admin screen', () => {
  assert.doesNotMatch(BALANCE_CHANGED, /pin/i)
})
