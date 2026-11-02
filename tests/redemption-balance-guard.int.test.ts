// Money arriving while a redemption is open must never be wiped by approving it. Real prisma; rows
// are scoped by a run id and removed by id. sk_test_ makes the paystack lib short-circuit.
process.env.PAYSTACK_SECRET_KEY = 'sk_test_balance_guard'
process.env.NEXTAUTH_URL = 'http://localhost:3000'
process.env.NEXTAUTH_SECRET ??= 'test-secret'
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
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
// Live-mode calls land here, so a test can script Paystack's answer (or run code while it "answers").
let paystackLive: ((path: string) => unknown) | null = null
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url.toString()
  if (paystackLive && u.includes('api.paystack.co') && !u.includes('/transaction/initialize')) {
    const { http, ...answer } = (await paystackLive(new URL(u).pathname)) as { status: boolean; http?: number }
    return new Response(JSON.stringify(answer), { status: http ?? (answer.status ? 200 : 400) })
  }
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
const { BALANCE_CHANGED, closePlanAfterFinalize, creditOpenPlan, hasOpenRedemption, PlanClosedError } = require('../src/lib/redemption-balance') as typeof import('../src/lib/redemption-balance')
const er = require('../src/app/api/admin/early-redemption/[id]/route') as typeof import('../src/app/api/admin/early-redemption/[id]/route')
const fin = require('../src/app/api/admin/early-redemption/[id]/finalize-otp/route') as typeof import('../src/app/api/admin/early-redemption/[id]/finalize-otp/route')
const verifyRoute = require('../src/app/api/admin/early-redemption/[id]/verify/route') as typeof import('../src/app/api/admin/early-redemption/[id]/verify/route')
const saving = require('../src/app/api/transactions/saving/route') as typeof import('../src/app/api/transactions/saving/route')
const bulk = require('../src/app/api/transactions/saving/bulk/route') as typeof import('../src/app/api/transactions/saving/bulk/route')
const autoDebitInit = require('../src/app/api/customer/auto-debit/init/route') as typeof import('../src/app/api/customer/auto-debit/init/route')
const init = require('../src/app/api/customer/paystack/init/route') as typeof import('../src/app/api/customer/paystack/init/route')
const redeemRoute = require('../src/app/api/customer/redeem/route') as typeof import('../src/app/api/customer/redeem/route')
const meRoute = require('../src/app/api/customer/me/route') as typeof import('../src/app/api/customer/me/route')
const requestRoute = require('../src/app/api/transactions/redemption/request/route') as typeof import('../src/app/api/transactions/redemption/request/route')
const adminList = require('../src/app/api/admin/early-redemption/route') as typeof import('../src/app/api/admin/early-redemption/route')
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
const saveBulk = (planId: string, dates = ['2026-01-01', '2026-01-02']) => bulk.POST({ json: async () => ({ customerId, dates, method: 'Cash', planId }) } as never)
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
async function withLivePaystack<T>(handler: (path: string) => unknown, fn: () => Promise<T>): Promise<T> {
  const key = process.env.PAYSTACK_SECRET_KEY
  process.env.PAYSTACK_SECRET_KEY = 'sk_live_stubbed_never_sent'
  paystackLive = handler
  try { return await fn() } finally { process.env.PAYSTACK_SECRET_KEY = key; paystackLive = null }
}
const recipientThen = (transfer: (path: string) => unknown) => (path: string) =>
  path.includes('/transferrecipient') ? { status: true, data: { recipient_code: 'RCP_x' } } : transfer(path)
const verifyCall = (id: string) => verifyRoute.POST({} as never, ctx(id))
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
  currentToken = await signCustomerToken({ id: customerId, name: 'C X', phone: `08${RUN}3`, customerId: `RG-${RUN}` } as never)
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

test('finalize: money landing while Paystack answers still writes the ledger, keeps the deposit and flags it', async () => {
  const planId = await mkPlan(0, 'Redeemed')
  const r = await mkRedemption({ planId, method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_g` })
  const m0 = await money()
  const res = await withLivePaystack(async () => {
    await prisma.savingsPlan.update({ where: { id: planId }, data: { balance: { increment: 45000 } } })
    return { status: true, data: { status: 'success' } }
  }, () => finalize(r.id))
  assert.equal(res.status, 200)
  assert.equal((await res.json()).reviewNeeded, true)
  assert.equal((await erRow(r.id)).status, 'Approved')
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 1)
  const plan = await planRow(planId)
  assert.equal(plan.balance, 45000, 'the deposit survives')
  assert.equal(plan.status, 'Redeemed')
  const m1 = await money()
  assert.equal(m1.commission, m0.commission + 300)
  assert.equal(m1.revenue, m0.revenue + 200)
  const flag = await prisma.auditLog.findFirstOrThrow({ where: { action: 'early_redemption_review_needed', entityId: r.id } })
  assert.match(flag.details ?? '', /MANUAL REVIEW/)
  assert.match(flag.details ?? '', /45,000/)
})

test('finalize: a clean payout is not flagged', async () => {
  const planId = await mkPlan(0, 'Redeemed')
  const r = await mkRedemption({ planId, method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_h` })
  assert.equal((await (await finalize(r.id)).json()).reviewNeeded, false)
  assert.equal(await prisma.auditLog.count({ where: { action: 'early_redemption_review_needed', entityId: r.id } }), 0)
})

test('finalize credits exactly what approve credits, from the stored penalty, with cash deposits on the plan', async () => {
  const credit = async (run: (id: string) => Promise<Response>, status: string, method: string, balance: number, planStatus: string) => {
    const planId = await mkPlan(balance, planStatus)
    // A cash deposit changes what a recalculated fee would come to.
    await prisma.transaction.create({ data: { ref: `RGC-${RUN}-${seq.n++}`, agentId, customerId, planId, type: 'saving', amount: 10000, method: 'Cash' } })
    const r = await mkRedemption({ planId, method, status, transferCode: status === 'AwaitingOTP' ? `TRF_${RUN}_${seq.n}` : undefined })
    const m0 = await money()
    assert.equal((await run(r.id)).status, 200)
    const m1 = await money()
    return { commission: m1.commission - m0.commission, revenue: m1.revenue - m0.revenue }
  }
  const viaOtp = await credit(finalize, 'AwaitingOTP', 'BankTransfer', 0, 'Redeemed')
  const viaApprove = await credit(approve, 'AgentApproved', 'BankTransfer', 10000, 'Active')
  assert.deepEqual(viaOtp, { commission: 300, revenue: 200 })
  assert.deepEqual(viaApprove, viaOtp)
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

// ---------- a transfer that didn't happen, or might have ----------
test('a failed transfer adds the balance back on top of a deposit that landed meanwhile', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, method: 'BankTransfer' })
  const res = await withLivePaystack(recipientThen(async () => {
    await prisma.savingsPlan.update({ where: { id: planId }, data: { balance: { increment: 45000 } } })
    return { status: true, data: { transfer_code: 'TRF_f', status: 'failed' } }
  }), () => approve(r.id))
  assert.equal(res.status, 502)
  const plan = await planRow(planId)
  assert.equal(plan.balance, 55000, 'nothing erased')
  assert.equal(plan.status, 'Active')
  assert.equal((await erRow(r.id)).status, 'AgentApproved')
  const again = await approve(r.id)
  assert.equal(again.status, 409)
  assert.equal((await again.json()).error, BALANCE_CHANGED)
})

test('a definite Paystack rejection releases the claim so the admin can retry', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, method: 'BankTransfer' })
  const res = await withLivePaystack(recipientThen(() => ({ status: false, message: 'Insufficient balance' })), () => approve(r.id))
  assert.equal(res.status, 502)
  assert.equal((await erRow(r.id)).status, 'AgentApproved')
  assert.equal((await planRow(planId)).balance, 10000)
  assert.equal((await planRow(planId)).status, 'Active')
})

test('a failure before Paystack is asked for a transfer releases the claim', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, method: 'BankTransfer' })
  const res = await withLivePaystack(() => { throw new Error('network down') }, () => approve(r.id))
  assert.equal(res.status, 502)
  assert.equal((await erRow(r.id)).status, 'AgentApproved')
  assert.equal((await planRow(planId)).balance, 10000)
})

test('a timeout on the transfer call stays Processing: no release, no second transfer', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, method: 'BankTransfer' })
  let transfers = 0
  const res = await withLivePaystack(recipientThen(() => { transfers++; throw new DOMException('timed out', 'TimeoutError') }), async () => {
    const first = await approve(r.id)
    assert.equal((await erRow(r.id)).status, 'Processing')
    assert.equal((await approve(r.id)).status, 409, 'a second approve never reaches Paystack')
    return first
  })
  assert.equal(res.status, 502)
  assert.match((await res.json()).error, /Don’t approve it again/)
  assert.equal(transfers, 1)
  const plan = await planRow(planId)
  assert.equal(plan.balance, 0)
  assert.equal(plan.status, 'Redeemed')
})

async function stuckProcessing(balance = 0, startedMinutesAgo = 60) {
  const planId = await mkPlan(balance, 'Redeemed')
  const r = await mkRedemption({ planId, method: 'BankTransfer', status: 'Processing' })
  await prisma.earlyRedemption.update({ where: { id: r.id }, data: { decidedAt: new Date(Date.now() - startedMinutesAgo * 60_000) } })
  return { planId, r }
}

test('approve stamps when the transfer started, and a release clears it', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, method: 'BankTransfer' })
  await withLivePaystack(recipientThen(async () => {
    assert.ok((await erRow(r.id)).decidedAt, 'stamped before Paystack is called')
    return { status: false, message: 'No' }
  }), () => approve(r.id))
  const row = await erRow(r.id)
  assert.equal(row.status, 'AgentApproved')
  assert.equal(row.decidedAt, null)
})

test('only a plain 4xx refusal releases: a 5xx, rate limit or duplicate reference stays Processing', async () => {
  const answers = [
    { status: false, http: 500, message: 'Server error' },
    { status: false, http: 429, message: 'Slow down' },
    { status: false, http: 400, message: 'Duplicate Transfer Reference' },
  ]
  for (const answer of answers) {
    const planId = await mkPlan(10000)
    const r = await mkRedemption({ planId, method: 'BankTransfer' })
    const res = await withLivePaystack(recipientThen(() => answer), () => approve(r.id))
    assert.equal(res.status, 502, answer.message)
    assert.equal((await erRow(r.id)).status, 'Processing', answer.message)
    assert.equal((await planRow(planId)).balance, 0, answer.message)
  }
})

test('verify: the transfer went through, so the ledger completes once', async () => {
  const { planId, r } = await stuckProcessing()
  const m0 = await money()
  const res = await withLivePaystack(() => ({ status: true, data: { status: 'success', transfer_code: 'TRF_ok' } }), () => verifyCall(r.id))
  assert.deepEqual(await res.json(), { ok: true, status: 'Approved', bankTransferStatus: 'success' })
  const row = await erRow(r.id)
  assert.equal(row.status, 'Approved')
  assert.equal(row.paystackTransferCode, 'TRF_ok')
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 1)
  const m1 = await money()
  assert.equal(m1.commission, m0.commission + 300)
  assert.equal(m1.revenue, m0.revenue + 200)
  assert.equal(m1.wallet, m0.wallet, 'Paystack paid, so no agent wallet credit')
  assert.equal((await planRow(planId)).status, 'Redeemed')
  assert.equal((await verifyCall(r.id)).status, 409)
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 1)
})

test('verify: failed, reversed or not found reopens the plan with the money, keeping any deposit', async () => {
  const answers: [string, unknown, string | null][] = [
    ['failed', { status: true, data: { status: 'failed' } }, 'failed'],
    ['reversed', { status: true, data: { status: 'reversed' } }, 'reversed'],
    ['not found', { status: false, message: 'Transfer not found' }, null],
  ]
  for (const [label, answer, stored] of answers) {
    const { planId, r } = await stuckProcessing(45000)
    const m0 = await money()
    const res = await withLivePaystack(() => answer, () => verifyCall(r.id))
    assert.equal(res.status, 200, label)
    const row = await erRow(r.id)
    assert.equal(row.status, 'AgentApproved', label)
    assert.equal(row.bankTransferStatus, stored, label)
    const plan = await planRow(planId)
    assert.equal(plan.balance, 55000, label)
    assert.equal(plan.status, 'Active', label)
    assert.deepEqual(await money(), m0, label)
    assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 0, label)
  }
})

test('verify: only success records a payout; pending and unknown statuses change nothing', async () => {
  for (const status of ['pending', 'received', 'abandoned', 'blocked', 'rejected', 'something_new']) {
    const { planId, r } = await stuckProcessing()
    const m0 = await money()
    const res = await withLivePaystack(() => ({ status: true, data: { status } }), () => verifyCall(r.id))
    assert.deepEqual(await res.json(), { ok: true, status: 'Processing', bankTransferStatus: status }, status)
    assert.equal((await erRow(r.id)).status, 'Processing', status)
    assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 0, status)
    assert.equal((await planRow(planId)).status, 'Redeemed', status)
    assert.deepEqual(await money(), m0, status)
  }
})

test('verify: not found on a recent transfer changes nothing, because it may still appear', async () => {
  const { planId, r } = await stuckProcessing(0, 5)
  const res = await withLivePaystack(() => ({ status: false, message: 'Transfer not found' }), () => verifyCall(r.id))
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /check again in 30 minutes/)
  assert.equal((await erRow(r.id)).status, 'Processing')
  assert.equal((await planRow(planId)).status, 'Redeemed')
})

test('verify: a 5xx saying not found is not an answer', async () => {
  const { r } = await stuckProcessing()
  const res = await withLivePaystack(() => ({ status: false, http: 503, message: 'Transfer not found' }), () => verifyCall(r.id))
  assert.equal(res.status, 502)
  assert.equal((await erRow(r.id)).status, 'Processing')
})

test('verify: Paystack asking for a code moves the request to AwaitingOTP', async () => {
  const { r } = await stuckProcessing()
  const res = await withLivePaystack(() => ({ status: true, data: { status: 'otp', transfer_code: 'TRF_otp' } }), () => verifyCall(r.id))
  assert.equal((await res.json()).status, 'AwaitingOTP')
  const row = await erRow(r.id)
  assert.equal(row.status, 'AwaitingOTP')
  assert.equal(row.paystackTransferCode, 'TRF_otp')
})

test('verify: no clear answer from Paystack changes nothing', async () => {
  for (const handler of [() => { throw new Error('network down') }, () => ({ status: false, http: 401, message: 'Invalid key' })]) {
    const { planId, r } = await stuckProcessing()
    const m0 = await money()
    assert.equal((await withLivePaystack(handler, () => verifyCall(r.id))).status, 502)
    assert.equal((await erRow(r.id)).status, 'Processing')
    assert.equal((await planRow(planId)).status, 'Redeemed')
    assert.deepEqual(await money(), m0)
  }
})

test('verify: admin only, and only for a Processing request', async () => {
  const { r } = await stuckProcessing()
  stub.getServerSession = async () => ({ user: { id: 'x', role: 'agent' } })
  assert.equal((await verifyCall(r.id)).status, 403)
  asAdmin()
  const planId = await mkPlan(10000)
  const open = await mkRedemption({ planId })
  assert.equal((await verifyCall(open.id)).status, 409)
})

test('rejecting one request does not reopen a plan another request closed', async () => {
  const planId = await mkPlan(0, 'Redeemed')
  const stale = await mkRedemption({ planId, status: 'Pending', tokenExpiry: new Date(Date.now() - 60_000) })
  await mkRedemption({ planId, method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_s` })
  assert.equal((await reject(stale.id)).status, 200)
  assert.equal((await planRow(planId)).status, 'Redeemed')
})

// ---------- removed and gated paths ----------
test('the direct agent redemption route is gone', () => {
  assert.equal(existsSync('src/app/api/transactions/redemption/route.ts'), false)
  assert.equal(existsSync('src/app/api/transactions/redemption/request/route.ts'), true)
})

test('a request with a code cannot be approved until it is confirmed', async () => {
  for (const tokenExpiry of [new Date(Date.now() + 60_000), new Date(Date.now() - 60_000)]) {
    const planId = await mkPlan(10000)
    const r = await mkRedemption({ planId, status: 'Pending', tokenExpiry })
    const m0 = await money()
    const res = await approve(r.id)
    assert.equal(res.status, 409)
    assert.match((await res.json()).error, /hasn’t confirmed this request with their code/)
    assert.equal((await erRow(r.id)).status, 'Pending')
    assert.equal((await planRow(planId)).balance, 10000)
    assert.deepEqual(await money(), m0)
    assert.equal((await reject(r.id)).status, 200, 'it can still be rejected')
  }
})

test('an admin-created request (no code) can still be approved from Pending', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, status: 'Pending', tokenExpiry: null })
  assert.equal((await approve(r.id)).status, 200)
  assert.equal((await planRow(planId)).balance, 0)
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

test('the agent\'s 409 says what to do next', async () => {
  const planId = await mkPlan(10000)
  await mkRedemption({ planId, status: 'Pending' })
  asAgent()
  const { error } = await (await save(planId)).json()
  assert.match(error, /Wait for the office to decide, or ask an admin to reject/)
})

test('bulk saving: 409 during an open request, nothing debited, and it works once closed', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, status: 'TokenValidated' })
  asAgent()
  const m0 = await money()
  const res = await saveBulk(planId)
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /Wait for the office/)
  assert.equal((await planRow(planId)).balance, 10000)
  assert.deepEqual(await money(), m0)
  asAdmin()
  assert.equal((await reject(r.id)).status, 200)
  asAgent()
  assert.equal((await saveBulk(planId)).status, 200)
  assert.equal((await planRow(planId)).balance, 10200)
})

test('auto-debit setup: 409 during an open request', async () => {
  const planId = await mkPlan(10000)
  await prisma.savingsPlan.update({ where: { id: planId }, data: { source: 'self' } })
  await mkRedemption({ planId, status: 'Pending' })
  const res = await autoDebitInit.POST({ json: async () => ({ planId }) } as never)
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /collect/i)
  assert.equal(await prisma.paymentIntent.count({ where: { customerId, planId } }), 0)
})

test('a saving into a plan that closed after it was loaded undoes the debit', async () => {
  for (const [label, send] of [['single', save], ['bulk', saveBulk]] as const) {
    const planId = await mkPlan(10000)
    asAgent()
    const m0 = await money()
    // The plan closes just after the last check, before the transaction runs.
    const realFind = prisma.earlyRedemption.findFirst
    prisma.earlyRedemption.findFirst = (async (...args: Parameters<typeof realFind>) => {
      const row = await realFind.apply(prisma.earlyRedemption, args)
      await prisma.savingsPlan.update({ where: { id: planId }, data: { status: 'Redeemed', balance: 0 } })
      return row
    }) as typeof prisma.earlyRedemption.findFirst
    try {
      const res = await send(planId)
      assert.equal(res.status, 409, label)
      assert.match((await res.json()).error, /closed/)
    } finally { prisma.earlyRedemption.findFirst = realFind }
    assert.equal((await planRow(planId)).balance, 0, label)
    assert.deepEqual(await money(), m0, label)
    assert.equal(await prisma.transaction.count({ where: { planId } }), 0, label)
  }
})

test('creditOpenPlan refuses a Redeemed plan and credits an open one', async () => {
  const open = await mkPlan(100)
  await creditOpenPlan(prisma, open, 50)
  assert.equal((await planRow(open)).balance, 150)
  const closed = await mkPlan(0, 'Redeemed')
  await assert.rejects(creditOpenPlan(prisma, closed, 50), PlanClosedError)
  assert.equal((await planRow(closed)).balance, 0)
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

test('a deposit after an abandoned code cannot be paid out: no approval, and the money stays', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, status: 'Pending', tokenExpiry: new Date(Date.now() - 60_000) })
  asAgent()
  assert.equal((await save(planId)).status, 200)
  asAdmin()
  assert.equal((await approve(r.id)).status, 409)
  assert.equal((await planRow(planId)).balance, 10100)
})

// ---------- expired Pending, one definition everywhere ----------
const asCustomerRequest = (body: unknown) => ({ json: async () => body, headers: new Headers() }) as never

test('an online customer with an expired code is not stuck: new request, save and home all clear', async () => {
  const planId = await mkPlan(10000)
  await prisma.savingsPlan.update({ where: { id: planId }, data: { startDate: new Date(Date.now() + 864e5) } }) // the newest plan, which redeem reads
  const r = await mkRedemption({ planId, status: 'Pending', tokenExpiry: new Date(Date.now() - 60_000) })

  const me = await (await meRoute.GET()).json()
  assert.ok(!me.pendingRedemptions.some((p: { savingsPlanId: string }) => p.savingsPlanId === planId), 'save page reads this')

  const listed = await (await redeemRoute.GET()).json()
  const row = listed.redemptions.find((x: { id: string }) => x.id === r.id)
  assert.equal(row.expired, true)
  assert.equal(row.status, 'Pending', 'status stays honest')
  assert.equal(row.token, undefined)
  assert.equal(row.tokenExpiry, undefined)

  const res = await redeemRoute.POST(asCustomerRequest({ reason: 'x' }))
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()))
  const { ref } = await res.json()
  refs.push(ref)
  const fresh = await prisma.earlyRedemption.findUniqueOrThrow({ where: { ref } })
  erIds.push(fresh.id)
  assert.equal((await erRow(r.id)).status, 'Pending', 'the old row is not rewritten')
  await prisma.earlyRedemption.update({ where: { id: fresh.id }, data: { status: 'Rejected' } })
  await prisma.savingsPlan.update({ where: { id: planId }, data: { status: 'Completed' } })
})

test('a live code still holds everything', async () => {
  const planId = await mkPlan(10000)
  await prisma.savingsPlan.update({ where: { id: planId }, data: { startDate: new Date(Date.now() + 2 * 864e5) } })
  await mkRedemption({ planId, status: 'Pending', tokenExpiry: new Date(Date.now() + 60_000) })
  const me = await (await meRoute.GET()).json()
  assert.ok(me.pendingRedemptions.some((p: { savingsPlanId: string }) => p.savingsPlanId === planId))
  assert.equal((await redeemRoute.POST(asCustomerRequest({ reason: 'x' }))).status, 409)
  await prisma.savingsPlan.update({ where: { id: planId }, data: { status: 'Completed' } })
})

test('the agent request route allows a new one after a code expires, not before', async () => {
  const planId = await mkPlan(10000)
  await mkRedemption({ planId, status: 'Pending', tokenExpiry: new Date(Date.now() + 60_000) })
  asAgent()
  const body = { customerId, planId, payoutMethod: 'Cash' }
  assert.equal((await requestRoute.POST({ json: async () => body } as never)).status, 409)
  await prisma.earlyRedemption.updateMany({ where: { savingsPlanId: planId }, data: { tokenExpiry: new Date(Date.now() - 60_000) } })
  const res = await requestRoute.POST({ json: async () => body } as never)
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()))
  const { ref } = await res.json()
  refs.push(ref)
  erIds.push((await prisma.earlyRedemption.findUniqueOrThrow({ where: { ref } })).id)
})

test('admin create: refused while a request is in progress, allowed after an abandoned code', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, status: 'TokenValidated' })
  const create = () => adminList.POST({ json: async () => ({ savingsPlanId: planId, reason: 'x' }) } as never)
  assert.equal((await create()).status, 409)
  await prisma.earlyRedemption.update({ where: { id: r.id }, data: { status: 'Pending', tokenExpiry: new Date(Date.now() - 60_000) } })
  const res = await create()
  assert.equal(res.status, 200)
  const made = await res.json()
  refs.push(made.ref); erIds.push(made.id)
})

test('the admin list shows the current balance and flags a change, and only when it matters', async () => {
  const cases: [string, number, string, boolean][] = [
    ['unchanged', 10000, 'AgentApproved', false],
    ['deposit', 55000, 'AgentApproved', true],
    ['decided', 55000, 'Rejected', false],
  ]
  const made: [string, number, boolean][] = []
  for (const [, balance, status, flagged] of cases) {
    const planId = await mkPlan(balance)
    made.push([(await mkRedemption({ planId, status })).id, balance, flagged])
  }
  const otpClean = await mkRedemption({ planId: await mkPlan(0, 'Redeemed'), method: 'BankTransfer', status: 'AwaitingOTP' })
  made.push([otpClean.id, 0, false])
  const otpDeposit = await mkRedemption({ planId: await mkPlan(10000, 'Redeemed'), method: 'BankTransfer', status: 'AwaitingOTP' })
  made.push([otpDeposit.id, 10000, true])
  const { records } = await (await adminList.GET()).json()
  for (const [id, balance, flagged] of made) {
    const row = records.find((r: { id: string }) => r.id === id)
    assert.equal(row.currentBalance, balance)
    assert.equal(row.balanceChanged, flagged, `${id} at ${balance}`)
    assert.equal(row.balance, 10000)
  }
})

test('the refusal message is not mistaken for a PIN error on the admin screen', () => {
  assert.doesNotMatch(BALANCE_CHANGED, /pin/i)
})
