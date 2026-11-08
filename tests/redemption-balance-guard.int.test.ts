// Money arriving while a redemption is open must never be wiped by approving it. Real prisma; rows
// are scoped by a run id and removed by id. sk_test_ makes the paystack lib short-circuit.
process.env.PAYSTACK_SECRET_KEY = 'sk_test_balance_guard'
process.env.NEXTAUTH_URL = 'http://localhost:3000'
process.env.PAYSTACK_WEBHOOK_SECRET = 'whsec_guard'
process.env.NEXTAUTH_SECRET ??= 'test-secret'
import { test, before, after, beforeEach } from 'node:test'
import { NextRequest } from 'next/server'
import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'

let adminNotices = 0
let lastAdminWarning: string | undefined
const smsSent: string[] = []
let reviewAlerts = 0
const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => null }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  if (req.endsWith('kudisms')) return { ...mod, sendSMS: async (_to: string, text: string) => { smsSent.push(text); return { ok: true } } }
  if (req.endsWith('redemption-notify')) return { ...mod, notifySuperAdminsRedemptionPending: async (_c: unknown, input: { warning?: string }) => { adminNotices++; lastAdminWarning = input.warning }, notifySuperAdminsPayoutReview: async () => { reviewAlerts++ } }
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
const wdRoute = require('../src/app/api/admin/agent-withdrawal/[id]/route') as typeof import('../src/app/api/admin/agent-withdrawal/[id]/route')
const wdVerify = require('../src/app/api/admin/agent-withdrawal/[id]/verify/route') as typeof import('../src/app/api/admin/agent-withdrawal/[id]/verify/route')
const paystackWebhook = require('../src/app/api/paystack/webhook/route') as typeof import('../src/app/api/paystack/webhook/route')
const wdFinalizeRoute = require('../src/app/api/admin/agent-withdrawal/[id]/finalize-otp/route') as typeof import('../src/app/api/admin/agent-withdrawal/[id]/finalize-otp/route')
const enrollRoute = require('../src/app/api/customer/enroll/route') as typeof import('../src/app/api/customer/enroll/route')
const inviteRoute = require('../src/app/api/customer/enroll/invite/route') as typeof import('../src/app/api/customer/enroll/invite/route')
const verifyRoute = require('../src/app/api/admin/early-redemption/[id]/verify/route') as typeof import('../src/app/api/admin/early-redemption/[id]/verify/route')
const saving = require('../src/app/api/transactions/saving/route') as typeof import('../src/app/api/transactions/saving/route')
const bulk = require('../src/app/api/transactions/saving/bulk/route') as typeof import('../src/app/api/transactions/saving/bulk/route')
const autoDebitInit = require('../src/app/api/customer/auto-debit/init/route') as typeof import('../src/app/api/customer/auto-debit/init/route')
const init = require('../src/app/api/customer/paystack/init/route') as typeof import('../src/app/api/customer/paystack/init/route')
const redeemRoute = require('../src/app/api/customer/redeem/route') as typeof import('../src/app/api/customer/redeem/route')
const meRoute = require('../src/app/api/customer/me/route') as typeof import('../src/app/api/customer/me/route')
const verifyToken = require('../src/app/api/transactions/redemption/verify-token/route') as typeof import('../src/app/api/transactions/redemption/verify-token/route')
const lookupToken = require('../src/app/api/transactions/redemption/lookup-token/route') as typeof import('../src/app/api/transactions/redemption/lookup-token/route')
const { CODE_LOOKUPS_PER_HOUR, spendCodeLookup } = require('../src/lib/redemption-attempts') as typeof import('../src/lib/redemption-attempts')
const { hashRedemptionToken } = require('../src/lib/redemption-token') as typeof import('../src/lib/redemption-token')
const requestRoute = require('../src/app/api/transactions/redemption/request/route') as typeof import('../src/app/api/transactions/redemption/request/route')
const adminList = require('../src/app/api/admin/early-redemption/route') as typeof import('../src/app/api/admin/early-redemption/route')
/* eslint-enable @typescript-eslint/no-require-imports */

const RUN = Math.random().toString(36).slice(2, 8)
const suiteStart = new Date()
const PIN = '482913'
let adminId = ''
let agentId = ''
let agentCode = ''
let otherAgentId = ''
const otherAgentCode = `RGO-${RUN}`
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
const paidAnswer = (r: { ref: string }, over: Record<string, unknown> = {}) => ({ status: true, data: { status: 'success', reference: r.ref, amount: 950000, currency: 'NGN', transfer_code: 'TRF_ok', ...over } })
const statusAnswer = (r: { ref: string }, status: string, over: Record<string, unknown> = {}) => ({ status: true, data: { status, reference: r.ref, ...over } })
const verifyCall = (id: string) => verifyRoute.POST({} as never, ctx(id))
// Totals build up across the run, so compare them the way the app does, to the kobo.
const assertKobo = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.005, `${actual} != ${expected}`)
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
  otherAgentId = (await prisma.agent.create({ data: { agentId: otherAgentCode, phone: `0793${RUN}`, name: 'B', location: 'x', password: 'x' } })).id
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
  await prisma.agentWithdrawal.deleteMany({ where: { id: { in: wdIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: { in: [agentId, otherAgentId] } } })
  await prisma.loginAttempt.deleteMany({ where: { key: `redeem-lookup:agent:${agentId}` } })
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
  assertKobo((await money()).wallet, m0.wallet + 9500)
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
  assertKobo(m1.commission, m0.commission + 300)
  assertKobo(m1.revenue, m0.revenue + 200)
  const flag = await prisma.auditLog.findFirstOrThrow({ where: { action: 'early_redemption_review_needed', entityId: r.id } })
  assert.match(flag.details ?? '', /MANUAL REVIEW/)
  assert.match(flag.details ?? '', /45,000/)
})

test('finalize: on an open plan, only the new money stays; what was just paid comes off', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_o` })
  const res = await withLivePaystack(async () => {
    await prisma.savingsPlan.update({ where: { id: planId }, data: { balance: { increment: 45000 } } })
    return { status: true, data: { status: 'success' } }
  }, () => finalize(r.id))
  assert.equal((await res.json()).reviewNeeded, true)
  const plan = await planRow(planId)
  assert.equal(plan.balance, 45000)
  assert.equal(plan.status, 'Redeemed')
  const flag = await prisma.auditLog.findFirstOrThrow({ where: { action: 'early_redemption_review_needed', entityId: r.id } })
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
    return { commission: Math.round((m1.commission - m0.commission) * 100) / 100, revenue: Math.round((m1.revenue - m0.revenue) * 100) / 100 }
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
  const res = await withLivePaystack(() => paidAnswer(r), () => verifyCall(r.id))
  assert.deepEqual(await res.json(), { ok: true, status: 'Approved', bankTransferStatus: 'success', reviewNeeded: false })
  const row = await erRow(r.id)
  assert.equal(row.status, 'Approved')
  assert.equal(row.paystackTransferCode, 'TRF_ok')
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 1)
  const m1 = await money()
  assertKobo(m1.commission, m0.commission + 300)
  assertKobo(m1.revenue, m0.revenue + 200)
  assert.equal(m1.wallet, m0.wallet, 'Paystack paid, so no agent wallet credit')
  assert.equal((await planRow(planId)).status, 'Redeemed')
  assert.equal((await verifyCall(r.id)).status, 409)
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 1)
})

test('verify: what the docs say means no money left reopens the plan with the money, keeping any deposit', async () => {
  const answers: [string, (r: { ref: string }) => unknown, string | null][] = [
    ['failed', r => statusAnswer(r, 'failed'), 'failed'],
    ['reversed', r => statusAnswer(r, 'reversed'), 'reversed'],
    ['abandoned', r => statusAnswer(r, 'abandoned'), 'abandoned'],
    ['not found', () => ({ status: false, message: 'Transfer not found' }), null],
  ]
  for (const [label, answer, stored] of answers) {
    const { planId, r } = await stuckProcessing(45000)
    const m0 = await money()
    const res = await withLivePaystack(() => answer(r), () => verifyCall(r.id))
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

test('verify: pending, blocked, rejected and unknown statuses change nothing but what Paystack said', async () => {
  for (const status of ['pending', 'received', 'blocked', 'rejected', 'something_new']) {
    const { planId, r } = await stuckProcessing()
    const m0 = await money()
    const res = await withLivePaystack(() => statusAnswer(r, status), () => verifyCall(r.id))
    const body = await res.json()
    assert.equal(body.status, 'Processing', status)
    assert.equal(body.bankTransferStatus, status)
    const row = await erRow(r.id)
    assert.equal(row.status, 'Processing', status)
    assert.equal(row.bankTransferStatus, status)
    assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 0, status)
    assert.equal((await planRow(planId)).status, 'Redeemed', status)
    assert.deepEqual(await money(), m0, status)
  }
})

test('verify: an answer that does not match this payout writes nothing', async () => {
  const cases: [string, (r: { ref: string }) => unknown][] = [
    ['reference', r => paidAnswer(r, { reference: 'OTHER' })],
    ['amount', r => paidAnswer(r, { amount: 1 })],
    ['currency', r => paidAnswer(r, { currency: 'USD' })],
    ['reference on a failure', () => ({ status: true, data: { status: 'failed', reference: 'OTHER' } })],
  ]
  for (const [label, answer] of cases) {
    const { planId, r } = await stuckProcessing()
    const m0 = await money()
    const res = await withLivePaystack(() => answer(r), () => verifyCall(r.id))
    assert.equal(res.status, 409, label)
    assert.equal((await erRow(r.id)).status, 'Processing', label)
    assert.equal((await planRow(planId)).status, 'Redeemed', label)
    assert.deepEqual(await money(), m0, label)
  }
})

test('verify: an out-of-date answer cannot release a request approved again in the meantime', async () => {
  const { planId, r } = await stuckProcessing()
  const res = await withLivePaystack(async () => {
    await prisma.earlyRedemption.update({ where: { id: r.id }, data: { decidedAt: new Date() } })
    return statusAnswer(r, 'failed')
  }, () => verifyCall(r.id))
  assert.equal(res.status, 409)
  assert.equal((await erRow(r.id)).status, 'Processing')
  assert.equal((await planRow(planId)).status, 'Redeemed')
})

test('verify: acts on AwaitingOTP and Finalizing too', async () => {
  for (const from of ['AwaitingOTP', 'Finalizing']) {
    const paid = await mkRedemption({ planId: await mkPlan(0, 'Redeemed'), method: 'BankTransfer', status: from, transferCode: `TRF_${RUN}_v${from}` })
    assert.equal((await (await withLivePaystack(() => paidAnswer(paid), () => verifyCall(paid.id))).json()).status, 'Approved', from)
    assert.equal(await prisma.transaction.count({ where: { ref: paid.ref } }), 1, from)
    const planId = await mkPlan(0, 'Redeemed')
    const expired = await mkRedemption({ planId, method: 'BankTransfer', status: from, transferCode: `TRF_${RUN}_x${from}` })
    assert.equal((await (await withLivePaystack(() => statusAnswer(expired, 'abandoned'), () => verifyCall(expired.id))).json()).status, 'AgentApproved', from)
    assert.equal((await planRow(planId)).balance, 10000, from)
    assert.equal((await planRow(planId)).status, 'Active', from)
  }
})

test('verify: a paid record with a deposit on its plan is flagged, not zeroed', async () => {
  const { planId, r } = await stuckProcessing(45000)
  const body = await (await withLivePaystack(() => paidAnswer(r), () => verifyCall(r.id))).json()
  assert.equal(body.status, 'Approved')
  assert.equal(body.reviewNeeded, true)
  assert.equal((await planRow(planId)).balance, 45000)
  assert.equal(await prisma.auditLog.count({ where: { action: 'early_redemption_review_needed', entityId: r.id } }), 1)
})

test('verify: otp with no transfer code stays Processing rather than a record no one can finish', async () => {
  const { r } = await stuckProcessing()
  const body = await (await withLivePaystack(() => statusAnswer(r, 'otp'), () => verifyCall(r.id))).json()
  assert.equal(body.status, 'Processing')
  assert.equal((await erRow(r.id)).status, 'Processing')
})

test('verify: not found on a transfer we hold a code for changes nothing', async () => {
  const planId = await mkPlan(0, 'Redeemed')
  const r = await mkRedemption({ planId, method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_nf` })
  const body = await (await withLivePaystack(() => ({ status: false, message: 'Transfer not found' }), () => verifyCall(r.id))).json()
  assert.equal(body.status, 'AwaitingOTP')
  assert.equal((await planRow(planId)).status, 'Redeemed')
})

// ---------- what approve and finalize book as paid ----------
test('approve: success and pending book the payout as today; other answers do not', async () => {
  for (const status of ['success', 'pending']) {
    const planId = await mkPlan(10000)
    const r = await mkRedemption({ planId, method: 'BankTransfer' })
    const res = await withLivePaystack(recipientThen(() => ({ status: true, data: { transfer_code: `TRF_${status}`, status } })), () => approve(r.id))
    assert.equal(res.status, 200, status)
    assert.equal((await erRow(r.id)).status, 'Approved', status)
    assert.equal((await erRow(r.id)).bankTransferStatus, status)
    assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 1, status)
  }
  for (const status of ['received', 'blocked', 'rejected', 'something_new']) {
    const planId = await mkPlan(10000)
    const r = await mkRedemption({ planId, method: 'BankTransfer' })
    const res = await withLivePaystack(recipientThen(() => ({ status: true, data: { transfer_code: `TRF_${status}`, status } })), () => approve(r.id))
    assert.deepEqual(await res.json(), { ok: true, status: 'Processing', bankTransferStatus: status }, status)
    const row = await erRow(r.id)
    assert.equal(row.status, 'Processing', status)
    assert.equal(row.paystackTransferCode, `TRF_${status}`)
    assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 0, status)
    assert.equal((await planRow(planId)).balance, 0, status)
  }
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, method: 'BankTransfer' })
  assert.equal((await withLivePaystack(recipientThen(() => ({ status: true, data: { transfer_code: 'TRF_a', status: 'abandoned' } })), () => approve(r.id))).status, 502)
  assert.equal((await erRow(r.id)).status, 'AgentApproved')
  assert.equal((await planRow(planId)).balance, 10000)
})

async function awaitingOtp(tag: string) {
  tag = `${tag}${seq.n}`
  const planId = await mkPlan(0, 'Redeemed')
  const r = await mkRedemption({ planId, method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_${tag}` })
  return { planId, r }
}

test('finalize: failed or reversed reopens the plan and books nothing', async () => {
  for (const status of ['failed', 'reversed']) {
    const { planId, r } = await awaitingOtp(`f${status}`)
    const m0 = await money()
    const res = await withLivePaystack(() => ({ status: true, data: { status } }), () => finalize(r.id))
    assert.equal(res.status, 502, status)
    const row = await erRow(r.id)
    assert.equal(row.status, 'AgentApproved', status)
    assert.equal(row.bankTransferStatus, status)
    const plan = await planRow(planId)
    assert.equal(plan.balance, 10000, status)
    assert.equal(plan.status, 'Active', status)
    assert.deepEqual(await money(), m0, status)
    assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 0, status)
  }
})

test('finalize: anything but an explicit success stays Finalizing, including no status at all', async () => {
  const answers: [string, unknown][] = [
    ['pending', { status: true, data: { status: 'pending' } }],
    ['no status', { status: true, data: {} }],
    ['no data', { status: true }],
    ['unknown', { status: true, data: { status: 'something_new' } }],
  ]
  for (const [label, answer] of answers) {
    const { r } = await awaitingOtp(`s${label.replace(/\s/g, '')}`)
    const m0 = await money()
    const res = await withLivePaystack(() => answer, () => finalize(r.id))
    assert.equal(res.status, 200, label)
    assert.equal((await res.json()).status, 'Finalizing', label)
    assert.equal((await erRow(r.id)).status, 'Finalizing', label)
    assert.deepEqual(await money(), m0, label)
    assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 0, label)
  }
})

test('finalize: a wrong code goes back for a retry; a 5xx or 429 is not taken as a wrong code', async () => {
  const wrong = await awaitingOtp('w')
  assert.equal((await withLivePaystack(() => ({ status: false, message: 'Invalid OTP' }), () => finalize(wrong.r.id))).status, 400)
  assert.equal((await erRow(wrong.r.id)).status, 'AwaitingOTP')
  for (const http of [500, 429]) {
    const { r } = await awaitingOtp(`h${http}`)
    assert.equal((await withLivePaystack(() => ({ status: false, http, message: 'Busy' }), () => finalize(r.id))).status, 502, String(http))
    assert.equal((await erRow(r.id)).status, 'Finalizing', String(http))
  }
})

// ---------- the way out of AwaitingOTP ----------
test('reject from AwaitingOTP: restores the balance on top of a deposit, and the code can no longer be used', async () => {
  for (const status of ['abandoned', 'failed', 'reversed']) {
    const planId = await mkPlan(45000, 'Redeemed')
    const r = await mkRedemption({ planId, method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_rj${status}` })
    const m0 = await money()
    assert.equal((await withLivePaystack(() => statusAnswer(r, status), () => reject(r.id))).status, 200, status)
    assert.equal((await erRow(r.id)).status, 'Rejected', status)
    const plan = await planRow(planId)
    assert.equal(plan.balance, 55000, status)
    assert.equal(plan.status, 'Active', status)
    assert.deepEqual(await money(), m0, status)
    assert.equal((await finalize(r.id)).status, 409, status)
    assert.equal((await reject(r.id)).status, 409, 'once only')
    assert.equal((await planRow(planId)).balance, 55000, status)
  }
})

test('reject from AwaitingOTP is refused unless Paystack clearly says the money has not gone', async () => {
  const answers: [string, (r: { ref: string }) => unknown][] = [
    ['code still live', r => statusAnswer(r, 'otp')],
    ['already paid', r => paidAnswer(r)],
    ['pending', r => statusAnswer(r, 'pending')],
    ['blocked', r => statusAnswer(r, 'blocked')],
    ['another transfer', () => ({ status: true, data: { status: 'otp', reference: 'OTHER' } })],
    ['refused', () => ({ status: false, message: 'Transfer not found' })],
    ['5xx', () => ({ status: false, http: 503, message: 'Down' })],
    ['network', () => { throw new Error('network down') }],
  ]
  for (const [label, answer] of answers) {
    const planId = await mkPlan(0, 'Redeemed')
    const r = await mkRedemption({ planId, method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_rf${label.replace(/\s/g, '')}` })
    const res = await withLivePaystack(() => answer(r), () => reject(r.id))
    assert.equal(res.status, 409, label)
    assert.match((await res.json()).error, /Check with Paystack/)
    assert.equal((await erRow(r.id)).status, 'AwaitingOTP', label)
    assert.equal((await planRow(planId)).status, 'Redeemed', label)
    assert.equal((await planRow(planId)).balance, 0, label)
  }
})

test('verify: otp never moves a Finalizing record back to AwaitingOTP', async () => {
  const planId = await mkPlan(0, 'Redeemed')
  const r = await mkRedemption({ planId, method: 'BankTransfer', status: 'Finalizing', transferCode: `TRF_${RUN}_fo` })
  const body = await (await withLivePaystack(() => statusAnswer(r, 'otp', { transfer_code: 'TRF_x' }), () => verifyCall(r.id))).json()
  assert.equal(body.status, 'Finalizing')
  const row = await erRow(r.id)
  assert.equal(row.status, 'Finalizing')
  assert.equal(row.bankTransferStatus, 'otp')
  assert.equal(row.paystackTransferCode, `TRF_${RUN}_fo`)
})

test('finalize: only a refusal about the code allows another try', async () => {
  for (const message of ['Invalid OTP', 'The code you entered is wrong']) {
    const { r } = await awaitingOtp(`m${message.length}`)
    assert.equal((await withLivePaystack(() => ({ status: false, message }), () => finalize(r.id))).status, 400, message)
    assert.equal((await erRow(r.id)).status, 'AwaitingOTP', message)
  }
  for (const message of ['Transfer has been processed', 'Insufficient balance', 'Something went wrong']) {
    const { r } = await awaitingOtp(`n${message.length}`)
    assert.equal((await withLivePaystack(() => ({ status: false, message }), () => finalize(r.id))).status, 502, message)
    assert.equal((await erRow(r.id)).status, 'Finalizing', message)
  }
})

test('reject still refuses Processing and Finalizing, where money may have gone', async () => {
  for (const status of ['Processing', 'Finalizing']) {
    const planId = await mkPlan(0, 'Redeemed')
    const r = await mkRedemption({ planId, method: 'BankTransfer', status })
    assert.equal((await reject(r.id)).status, 409, status)
    assert.equal((await planRow(planId)).status, 'Redeemed', status)
  }
})

// ---------- agent confirmation and agent route ----------
test('agent routes only move a request from TokenValidated, once', async () => {
  const route = require('../src/app/api/agent/redemption/[id]/route') as typeof import('../src/app/api/agent/redemption/[id]/route') // eslint-disable-line @typescript-eslint/no-require-imports
  asAgent()
  const call = (id: string, action: string) => route.PATCH({ json: async () => ({ action }) } as never, ctx(id))
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, status: 'TokenValidated' })
  // The request changes hands between the route's read and its write.
  const realFind = prisma.earlyRedemption.findUnique
  prisma.earlyRedemption.findUnique = (async (...args: Parameters<typeof realFind>) => {
    const row = await realFind.apply(prisma.earlyRedemption, args)
    await prisma.earlyRedemption.update({ where: { id: r.id }, data: { status: 'Rejected' } })
    return row
  }) as unknown as typeof prisma.earlyRedemption.findUnique
  try {
    assert.equal((await call(r.id, 'approve')).status, 409)
  } finally { prisma.earlyRedemption.findUnique = realFind }
  assert.equal((await erRow(r.id)).status, 'Rejected', 'a decided request is not reopened')
})

// ---------- where an agent can send a payout ----------
const bankPaystack = (accountName: string) => (path: string) => {
  if (path.endsWith('/bank/resolve')) return { status: true, data: { account_name: accountName, account_number: '0123456789' } }
  if (path.endsWith('/bank')) return { status: true, data: [{ code: '058', name: 'GTBank' }] }
  return { status: false, message: `unexpected ${path}` }
}
const bankBody = (planId: string, over: Record<string, unknown> = {}) => ({ customerId, planId, payoutMethod: 'Bank Transfer', accountNumber: '0123456789', bankCode: '058', accountName: 'C X', bankName: 'Fake Bank', ...over })
const requestBank = (body: unknown, accountName: string) => withLivePaystack(bankPaystack(accountName), () => requestRoute.POST({ json: async () => body } as never))

test('agent bank payout: name and bank come from Paystack, never the request', async () => {
  const planId = await mkPlan(10000)
  asAgent()
  const res = await requestBank(bankBody(planId), 'X CHIOMA C')
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()))
  const { ref } = await res.json()
  refs.push(ref)
  const row = await prisma.earlyRedemption.findUniqueOrThrow({ where: { ref } })
  erIds.push(row.id)
  assert.equal(row.accountName, 'X CHIOMA C')
  assert.equal(row.bankName, 'GTBank')
})

const heldRequest = async (accountName = 'SOME AGENT') => {
  const planId = await mkPlan(10000)
  asAgent()
  const res = await requestBank(bankBody(planId, { accountName: 'C X' }), accountName)
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()))
  const body = await res.json()
  refs.push(body.ref)
  const row = await prisma.earlyRedemption.findUniqueOrThrow({ where: { ref: body.ref } })
  erIds.push(row.id)
  await prisma.earlyRedemption.update({ where: { id: row.id }, data: { status: 'AgentApproved' } })
  asAdmin()
  return { planId, row, body }
}
const approveOverride = (id: string, pin = PIN) => er.PATCH({ json: async () => ({ action: 'approve', pin, overrideNameMismatch: true }) } as never, ctx(id))

test('name mismatch: the request is held, not refused, and the agent is told', async () => {
  for (const payoutMethod of ['Bank Transfer', 'BankTransfer']) {
    const planId = await mkPlan(10000)
    asAgent()
    const res = await requestBank(bankBody(planId, { payoutMethod, accountName: 'C X' }), 'SOME AGENT')
    assert.equal(res.status, 200, payoutMethod)
    const body = await res.json()
    refs.push(body.ref)
    assert.match(body.nameCheckNote, /in the name SOME AGENT, not C X.*super admin.*Vochus app/)
    const row = await prisma.earlyRedemption.findUniqueOrThrow({ where: { ref: body.ref } })
    erIds.push(row.id)
    assert.equal(row.accountName, 'SOME AGENT', 'the resolved name, not what was sent')
    assert.equal(row.bankName, 'GTBank')
  }
})

test('name mismatch: a plain approve is refused and nothing moves; a matching name is not held', async () => {
  const { planId, row } = await heldRequest()
  const m0 = await money()
  const res = await er.PATCH({ json: async () => ({ action: 'approve', pin: PIN }) } as never, ctx(row.id))
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /in the name SOME AGENT, not C X/)
  assert.equal((await erRow(row.id)).status, 'AgentApproved')
  assert.equal((await planRow(planId)).balance, 10000)
  assert.deepEqual(await money(), m0)
  const { records } = await (await adminList.GET()).json()
  assert.equal(records.find((x: { id: string }) => x.id === row.id).nameMismatch, true)
  assert.equal(records.find((x: { id: string }) => x.id === row.id).accountName, 'SOME AGENT')
  const fine = await heldRequest('X C')
  assert.equal(records.find((x: { id: string }) => x.id === fine.row.id)?.nameMismatch ?? false, false)
  assert.equal((await er.PATCH({ json: async () => ({ action: 'approve', pin: PIN }) } as never, ctx(fine.row.id))).status, 200)
})

test('name mismatch: override needs the right PIN, pays, and audits both names', async () => {
  const { planId, row } = await heldRequest()
  assert.equal((await approveOverride(row.id, '000000')).status, 403)
  assert.equal((await erRow(row.id)).status, 'AgentApproved')
  await prisma.approvalPinAttempt.deleteMany({ where: { adminId } })
  assert.equal((await approveOverride(row.id)).status, 200)
  assert.equal((await erRow(row.id)).status, 'Approved')
  assert.equal((await planRow(planId)).balance, 0)
  await new Promise(done => setTimeout(done, 100)) // logAudit is fire-and-forget
  const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'early_redemption_name_override', entityId: row.id } })
  assert.match(log.details ?? '', /authorised .* customer C X, account name SOME AGENT, GTBank ending 6789/)
  assert.equal(log.actorId, adminId)
})

test('name mismatch: the customer is warned before giving their code, and a matching account is not', async () => {
  const before = smsSent.length
  await heldRequest()
  const held = smsSent[before]
  assert.match(held, /Payout goes to GTBank account ending 6789/)
  assert.match(held, /in the name SOME AGENT, not yours\. Don't share this code/)
  const fine = smsSent.length
  await heldRequest('X C')
  assert.match(smsSent[fine], /ending 6789/)
  assert.doesNotMatch(smsSent[fine], /not yours/)
})

test('name mismatch: super admins are told when the agent confirms the code', async () => {
  const planId = await mkPlan(10000)
  asAgent()
  const res = await requestBank(bankBody(planId), 'SOME AGENT')
  const { ref } = await res.json()
  refs.push(ref)
  const row = await prisma.earlyRedemption.findUniqueOrThrow({ where: { ref } })
  erIds.push(row.id)
  const code = uniqueCode()
  await prisma.earlyRedemption.update({ where: { id: row.id }, data: { token: hashRedemptionToken(code) } })
  assert.equal((await (await checkWithRef(ref, code)).json()).valid, true)
  assert.match(lastAdminWarning ?? '', /in the name SOME AGENT, not C X/)
})

test('name mismatch: the override is on record even when the payout stops at a code or an unclear answer', async () => {
  for (const status of ['otp', 'received']) {
    const { row } = await heldRequest()
    const res = await withLivePaystack(recipientThen(() => ({ status: true, data: { transfer_code: `TRF_ov_${status}`, status } })), () => approveOverride(row.id))
    assert.equal(res.status, 200, status)
    assert.notEqual((await erRow(row.id)).status, 'Approved', status)
    assert.equal(await prisma.auditLog.count({ where: { action: 'early_redemption_name_override', entityId: row.id } }), 1, status)
  }
})

test('name mismatch: a wrong PIN or a refused override leaves no override on record', async () => {
  const { row } = await heldRequest()
  await approveOverride(row.id, '000000')
  await prisma.approvalPinAttempt.deleteMany({ where: { adminId } })
  await er.PATCH({ json: async () => ({ action: 'approve', pin: PIN }) } as never, ctx(row.id))
  assert.equal(await prisma.auditLog.count({ where: { action: 'early_redemption_name_override', entityId: row.id } }), 0)
})

test('name mismatch: a non-admin cannot override, and an override on a matching name records nothing', async () => {
  const { row } = await heldRequest()
  stub.getServerSession = async () => ({ user: { id: 'x', role: 'agent' } })
  assert.equal((await approveOverride(row.id)).status, 403)
  asAdmin()
  const fine = await heldRequest('X C')
  assert.equal((await approveOverride(fine.row.id)).status, 200)
  await new Promise(done => setTimeout(done, 100))
  assert.equal(await prisma.auditLog.count({ where: { action: 'early_redemption_name_override', entityId: fine.row.id } }), 0)
})

test('agent request: online plans are refused with a pointer to the customer\'s app', async () => {
  const planId = await mkPlan(10000)
  await prisma.savingsPlan.update({ where: { id: planId }, data: { source: 'self' } })
  asAgent()
  const res = await requestRoute.POST({ json: async () => ({ customerId, planId, payoutMethod: 'Cash' }) } as never)
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /online plan.*their Vochus app/)
  assert.equal(await prisma.earlyRedemption.count({ where: { savingsPlanId: planId } }), 0)
})

test('agent request: ids must be strings, and the plan must be this agent\'s customer\'s', async () => {
  const planId = await mkPlan(10000)
  asAgent()
  const post = (body: unknown) => requestRoute.POST({ json: async () => body } as never)
  assert.equal((await post({ customerId, planId: { not: '' } })).status, 400)
  assert.equal((await post({ customerId: { not: '' }, planId })).status, 400)
  assert.equal((await post({ customerId: 'someone-else', planId, payoutMethod: 'Cash' })).status, 404)
  stub.getServerSession = async () => ({ user: { agentId: otherAgentCode } })
  assert.equal((await post({ customerId, planId, payoutMethod: 'Cash' })).status, 404, 'another agent')
  assert.equal(await prisma.earlyRedemption.count({ where: { savingsPlanId: planId } }), 0)
})

test('agent bank payout: the account number must be 10 digits, and be the one Paystack resolved', async () => {
  asAgent()
  for (const accountNumber of ['123', '01234567890', '0123456789&bank_code=999', '012345678a']) {
    const planId = await mkPlan(10000)
    const res = await requestBank(bankBody(planId, { accountNumber }), 'C X')
    assert.equal(res.status, 400, accountNumber)
    assert.match((await res.json()).error, /10 digits/)
  }
  const planId = await mkPlan(10000)
  const res = await requestBank(bankBody(planId, { accountNumber: '9999999999' }), 'C X')
  assert.equal(res.status, 400)
  assert.equal(await prisma.earlyRedemption.count({ where: { savingsPlanId: planId } }), 0)
})

test('agent bank payout: an account Paystack can\'t resolve is refused', async () => {
  const planId = await mkPlan(10000)
  asAgent()
  const res = await withLivePaystack(() => ({ status: false, message: 'Could not resolve' }), () => requestRoute.POST({ json: async () => bankBody(planId) } as never))
  assert.equal(res.status, 400)
  assert.equal(await prisma.earlyRedemption.count({ where: { savingsPlanId: planId } }), 0)
})

test('needsReview in the admin list: paid, closed, and money still on the plan', async () => {
  const flagged = await mkRedemption({ planId: await mkPlan(45000, 'Redeemed'), status: 'Approved' })
  const clean = await mkRedemption({ planId: await mkPlan(0, 'Redeemed'), status: 'Approved' })
  const open = await mkRedemption({ planId: await mkPlan(45000), status: 'AgentApproved' })
  const { records } = await (await adminList.GET()).json()
  const flag = (id: string) => records.find((x: { id: string }) => x.id === id).needsReview
  assert.equal(flag(flagged.id), true)
  assert.equal(flag(clean.id), false)
  assert.equal(flag(open.id), false)
})

test('admin create: a transfer in Processing counts as in flight', async () => {
  const planId = await mkPlan(0, 'Redeemed')
  await mkRedemption({ planId, method: 'BankTransfer', status: 'Processing' })
  assert.equal((await adminList.POST({ json: async () => ({ savingsPlanId: planId, reason: 'x' }) } as never)).status, 409)
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
  const res = await withLivePaystack(() => statusAnswer(r, 'otp', { transfer_code: 'TRF_otp' }), () => verifyCall(r.id))
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

// ---------- agent withdrawals: same rules as redemptions ----------
const wdIds: string[] = []
async function mkWithdrawal(status = 'Pending', over: { decidedAt?: Date | null; paystackTransferCode?: string | null } = {}) {
  const ref = `WG-${RUN}-${seq.n++}`
  const w = await prisma.agentWithdrawal.create({ data: { ref, agentId, amount: 500, status, accountNumber: '0123456789', bankCode: '058', accountName: 'A', decidedAt: new Date(Date.now() - 3_600_000), ...over } })
  wdIds.push(w.id)
  return w
}
const wdApprove = (id: string) => wdRoute.PATCH({ json: async () => ({ action: 'approve', pin: PIN }) } as never, ctx(id))
const wdCheck = (id: string) => wdVerify.POST({} as never, ctx(id))
const wdRow = (id: string) => prisma.agentWithdrawal.findUniqueOrThrow({ where: { id } })
const wdPaid = (w: { ref: string }, over: Record<string, unknown> = {}) => ({ status: true, data: { status: 'success', reference: w.ref, amount: 50000, currency: 'NGN', transfer_code: 'TRF_w', ...over } })

test('withdrawal approve: a timeout or 5xx stays Processing; a plain refusal or no call releases', async () => {
  for (const [label, transfer] of [
    ['timeout', () => { throw new DOMException('timed out', 'TimeoutError') }],
    ['5xx', () => ({ status: false, http: 500, message: 'Down' })],
    ['duplicate', () => ({ status: false, http: 400, message: 'Duplicate Transfer Reference' })],
  ] as const) {
    const w = await mkWithdrawal('Pending', { decidedAt: null })
    const res = await withLivePaystack(recipientThen(transfer), () => wdApprove(w.id))
    assert.equal(res.status, 502, label)
    assert.match((await res.json()).error, /Don’t approve it again/, label)
    assert.equal((await wdRow(w.id)).status, 'Processing', label)
    assert.equal((await wdApprove(w.id)).status, 409, `${label}: a second approve never reaches Paystack`)
  }
  const refused = await mkWithdrawal('Pending', { decidedAt: null })
  assert.equal((await withLivePaystack(recipientThen(() => ({ status: false, message: 'Insufficient balance' })), () => wdApprove(refused.id))).status, 502)
  assert.equal((await wdRow(refused.id)).status, 'Pending')
  const noCall = await mkWithdrawal('Pending', { decidedAt: null })
  assert.equal((await withLivePaystack(() => { throw new Error('network down') }, () => wdApprove(noCall.id))).status, 502)
  assert.equal((await wdRow(noCall.id)).status, 'Pending')
})

test('withdrawal verify: failed, reversed and abandoned refund once, from every in-flight status', async () => {
  for (const from of ['Processing', 'AwaitingOTP', 'Finalizing']) {
    for (const status of ['failed', 'reversed', 'abandoned']) {
      const w = await mkWithdrawal(from, { paystackTransferCode: 'TRF_w' })
      const m0 = await money()
      const res = await withLivePaystack(() => ({ status: true, data: { status, reference: w.ref } }), () => wdCheck(w.id))
      assert.equal((await res.json()).status, 'Rejected', `${from} ${status}`)
      assertKobo((await money()).commission, m0.commission + 500)
      assert.equal((await withLivePaystack(() => ({ status: true, data: { status, reference: w.ref } }), () => wdCheck(w.id))).status, 409)
      assertKobo((await money()).commission, m0.commission + 500)
    }
  }
})

test('withdrawal verify: success is checked against the withdrawal before it counts', async () => {
  const w = await mkWithdrawal('Finalizing', { paystackTransferCode: 'TRF_w' })
  assert.equal((await (await withLivePaystack(() => wdPaid(w), () => wdCheck(w.id))).json()).status, 'Approved')
  for (const [label, over] of [['reference', { reference: 'OTHER' }], ['amount', { amount: 1 }], ['currency', { currency: 'USD' }]] as const) {
    const bad = await mkWithdrawal('Processing', { paystackTransferCode: 'TRF_w' })
    const m0 = await money()
    assert.equal((await withLivePaystack(() => wdPaid(bad, over), () => wdCheck(bad.id))).status, 409, label)
    assert.equal((await wdRow(bad.id)).status, 'Processing', label)
    assert.deepEqual(await money(), m0, label)
  }
})

test('withdrawal verify: unsettled answers never move it, and Finalizing never goes back or to Processing', async () => {
  for (const from of ['AwaitingOTP', 'Finalizing']) {
    for (const status of ['pending', 'received', 'blocked', 'rejected', 'otp', 'something_new']) {
      const w = await mkWithdrawal(from, { paystackTransferCode: 'TRF_w' })
      const m0 = await money()
      const body = await (await withLivePaystack(() => ({ status: true, data: { status, reference: w.ref, transfer_code: 'TRF_w' } }), () => wdCheck(w.id))).json()
      assert.equal(body.status, from, `${from} ${status}`)
      const row = await wdRow(w.id)
      assert.equal(row.status, from, `${from} ${status}`)
      assert.equal(row.bankTransferStatus, status)
      assert.deepEqual(await money(), m0)
    }
  }
})

test('withdrawal verify: from Processing, otp moves to AwaitingOTP only with a code', async () => {
  const w = await mkWithdrawal('Processing')
  assert.equal((await (await withLivePaystack(() => ({ status: true, data: { status: 'otp', reference: w.ref, transfer_code: 'TRF_o' } }), () => wdCheck(w.id))).json()).status, 'AwaitingOTP')
  assert.equal((await wdRow(w.id)).paystackTransferCode, 'TRF_o')
  const noCode = await mkWithdrawal('Processing')
  assert.equal((await (await withLivePaystack(() => ({ status: true, data: { status: 'otp', reference: noCode.ref } }), () => wdCheck(noCode.id))).json()).status, 'Processing')
})

test('withdrawal verify: not found releases an old unconfirmed transfer with the commission still held, and only that', async () => {
  const old = await mkWithdrawal('Processing')
  const m0 = await money()
  const notFound = () => ({ status: false, message: 'Transfer not found' })
  assert.equal((await (await withLivePaystack(notFound, () => wdCheck(old.id))).json()).status, 'Pending')
  assert.deepEqual(await money(), m0, 'no refund: it can be approved again or rejected')
  const recent = await mkWithdrawal('Processing', { decidedAt: new Date() })
  assert.equal((await withLivePaystack(notFound, () => wdCheck(recent.id))).status, 409)
  assert.equal((await wdRow(recent.id)).status, 'Processing')
  const known = await mkWithdrawal('Processing', { paystackTransferCode: 'TRF_w' })
  assert.equal((await (await withLivePaystack(notFound, () => wdCheck(known.id))).json()).status, 'Processing')
  const down = await mkWithdrawal('Processing')
  assert.equal((await withLivePaystack(() => ({ status: false, http: 503, message: 'Transfer not found' }), () => wdCheck(down.id))).status, 502)
})

test('withdrawal verify: an out-of-date answer cannot refund a request approved again meanwhile', async () => {
  const w = await mkWithdrawal('Processing', { paystackTransferCode: 'TRF_w' })
  const m0 = await money()
  const res = await withLivePaystack(async () => {
    await prisma.agentWithdrawal.update({ where: { id: w.id }, data: { decidedAt: new Date() } })
    return { status: true, data: { status: 'failed', reference: w.ref } }
  }, () => wdCheck(w.id))
  assert.equal(res.status, 409)
  assert.deepEqual(await money(), m0)
})

// ---------- review trail ----------
const transferEvent = (event: string, data: Record<string, unknown>) => {
  const body = JSON.stringify({ event, data })
  const sig = crypto.createHmac('sha512', 'whsec_guard').update(body).digest('hex')
  return paystackWebhook.POST({ text: async () => body, headers: new Headers({ 'x-paystack-signature': sig }) } as never)
}

test('a transfer.success for a released or rejected request is audited with Paystack\'s answer and alerts admins', async () => {
  for (const status of ['Rejected', 'AgentApproved']) {
    const r = await mkRedemption({ planId: await mkPlan(10000), method: 'BankTransfer', status })
    const alerts = reviewAlerts
    assert.equal((await transferEvent('transfer.success', { transfer_code: `TRF_gone_${r.ref}`, reference: r.ref, amount: 950000, currency: 'NGN' })).status, 200)
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'early_redemption_paid_after_release', entityId: r.id } })
    assert.match(log.details ?? '', /MANUAL REVIEW/)
    assert.ok(log.details?.includes(`reference ${r.ref}`))
    assert.match(log.details ?? '', /950000 NGN/)
    assert.equal(reviewAlerts, alerts + 1)
    assert.equal((await erRow(r.id)).bankTransferStatus, 'success', 'the status write is kept')
    assert.equal((await erRow(r.id)).status, status, 'nothing else moves')
  }
})

test('a normal transfer.success or a failure raises no alert', async () => {
  const paid = await mkRedemption({ planId: await mkPlan(0, 'Redeemed'), method: 'BankTransfer', status: 'Approved', transferCode: `TRF_${RUN}_paid` })
  const alerts = reviewAlerts
  await transferEvent('transfer.success', { transfer_code: `TRF_${RUN}_paid`, reference: paid.ref })
  const rejected = await mkRedemption({ planId: await mkPlan(10000), method: 'BankTransfer', status: 'Rejected' })
  await transferEvent('transfer.failed', { transfer_code: 'x', reference: rejected.ref })
  assert.equal(reviewAlerts, alerts)
  assert.equal(await prisma.auditLog.count({ where: { action: 'early_redemption_paid_after_release', entityId: { in: [paid.id, rejected.id] } } }), 0)
})

test('a release clears the transfer code', async () => {
  const viaVerify = await mkRedemption({ planId: await mkPlan(0, 'Redeemed'), method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_cv` })
  await withLivePaystack(() => statusAnswer(viaVerify, 'abandoned'), () => verifyCall(viaVerify.id))
  assert.equal((await erRow(viaVerify.id)).paystackTransferCode, null)
  const viaFinalize = await mkRedemption({ planId: await mkPlan(0, 'Redeemed'), method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_cf` })
  await withLivePaystack(() => ({ status: true, data: { status: 'failed' } }), () => finalize(viaFinalize.id))
  assert.equal((await erRow(viaFinalize.id)).paystackTransferCode, null)
})

test('finalize audits both the no-money and the unclear answers', async () => {
  const settle = () => new Promise(done => setTimeout(done, 100)) // logAudit is fire-and-forget
  const failed = await mkRedemption({ planId: await mkPlan(0, 'Redeemed'), method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_af` })
  await withLivePaystack(() => ({ status: true, data: { status: 'failed' } }), () => finalize(failed.id))
  const unclear = await mkRedemption({ planId: await mkPlan(0, 'Redeemed'), method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_au` })
  await withLivePaystack(() => ({ status: true, data: { status: 'pending' } }), () => finalize(unclear.id))
  await settle()
  assert.match((await prisma.auditLog.findFirstOrThrow({ where: { action: 'early_redemption_otp_no_money', entityId: failed.id } })).details ?? '', /10,000 put back/)
  assert.match((await prisma.auditLog.findFirstOrThrow({ where: { action: 'early_redemption_otp_unclear', entityId: unclear.id } })).details ?? '', /"pending"/)
})

test('reject states the true amount restored, and a stale reject claims nothing', async () => {
  const settle = () => new Promise(done => setTimeout(done, 100))
  const r = await mkRedemption({ planId: await mkPlan(45000, 'Redeemed'), method: 'BankTransfer', status: 'AwaitingOTP', transferCode: `TRF_${RUN}_tr` })
  assert.equal((await withLivePaystack(() => statusAnswer(r, 'abandoned'), () => reject(r.id))).status, 200)
  await settle()
  const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'early_redemption_rejected', entityId: r.id } })
  assert.match(log.details ?? '', /₦10,000 put back on the plan, on top of ₦45,000/)
  const stale = await mkRedemption({ planId: await mkPlan(10000), status: 'AgentApproved' })
  const realFind = prisma.earlyRedemption.findUnique
  prisma.earlyRedemption.findUnique = (async (...args: Parameters<typeof realFind>) => {
    const row = await realFind.apply(prisma.earlyRedemption, args)
    await prisma.earlyRedemption.update({ where: { id: stale.id }, data: { decidedAt: new Date() } })
    return row
  }) as unknown as typeof prisma.earlyRedemption.findUnique
  try {
    assert.equal((await reject(stale.id)).status, 409)
  } finally { prisma.earlyRedemption.findUnique = realFind }
  assert.equal((await erRow(stale.id)).status, 'AgentApproved')
})

test('approve flags money that landed on the closed plan during the transfer, and keeps it', async () => {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, method: 'BankTransfer' })
  const res = await withLivePaystack(recipientThen(async () => {
    await prisma.savingsPlan.update({ where: { id: planId }, data: { balance: { increment: 45000 } } })
    return { status: true, data: { transfer_code: 'TRF_d', status: 'pending' } }
  }), () => approve(r.id))
  assert.equal((await res.json()).reviewNeeded, true)
  assert.equal((await erRow(r.id)).status, 'Approved')
  assert.equal((await planRow(planId)).balance, 45000)
  assert.equal(await prisma.auditLog.count({ where: { action: 'early_redemption_review_needed', entityId: r.id } }), 1)
})

test('agent bank payout: a Paystack outage says so, and a refusal does not', async () => {
  asAgent()
  const down = await withLivePaystack(() => { throw new Error('network down') }, () => requestRoute.POST({ json: async () => bankBody('x') } as never))
  assert.equal(down.status, 404, 'the plan is checked first')
  const planId = await mkPlan(10000)
  const out = await withLivePaystack(() => { throw new Error('network down') }, () => requestRoute.POST({ json: async () => bankBody(planId) } as never))
  assert.equal(out.status, 400)
  assert.match((await out.json()).error, /Paystack is unavailable/)
  const http5 = await withLivePaystack(() => ({ status: false, http: 503, message: 'Down' }), () => requestRoute.POST({ json: async () => bankBody(planId) } as never))
  assert.match((await http5.json()).error, /Paystack is unavailable/)
  const refused = await withLivePaystack(() => ({ status: false, message: 'Could not resolve' }), () => requestRoute.POST({ json: async () => bankBody(planId) } as never))
  assert.match((await refused.json()).error, /Could not verify/)
})

// ---------- a suspended agent: no money through them ----------
async function whileSuspended<T>(fn: () => Promise<T>): Promise<T> {
  await prisma.agent.update({ where: { id: agentId }, data: { status: 'Suspended' } })
  try { return await fn() } finally { await prisma.agent.update({ where: { id: agentId }, data: { status: 'Active' } }) }
}

test('suspended agent: withdrawal approve and finalize are refused, and nothing moves', async () => {
  await whileSuspended(async () => {
    const pending = await mkWithdrawal('Pending', { decidedAt: null })
    const a = await wdApprove(pending.id)
    assert.equal(a.status, 409)
    assert.match((await a.json()).error, /isn’t active/)
    assert.equal((await wdRow(pending.id)).status, 'Pending')
    const otp = await mkWithdrawal('AwaitingOTP', { paystackTransferCode: `TRF_${RUN}_wf` })
    let calls = 0
    const f = await withLivePaystack(() => { calls++; return { status: true, data: { status: 'success' } } }, () => wdFinalizeRoute.POST({ json: async () => ({ otp: '123456' }) } as never, ctx(otp.id)))
    assert.equal(f.status, 409)
    assert.equal(calls, 0, 'Paystack is never asked')
    assert.equal((await wdRow(otp.id)).status, 'AwaitingOTP')
  })
})

test('suspended agent: withdrawal reject still refunds and verify still resolves', async () => {
  await whileSuspended(async () => {
    const pending = await mkWithdrawal('Pending', { decidedAt: null })
    const m0 = await money()
    assert.equal((await wdRoute.PATCH({ json: async () => ({ action: 'reject' }) } as never, ctx(pending.id))).status, 200)
    assertKobo((await money()).commission, m0.commission + 500)
    const stuck = await mkWithdrawal('AwaitingOTP', { paystackTransferCode: 'TRF_w' })
    assert.equal((await (await withLivePaystack(() => ({ status: true, data: { status: 'abandoned', reference: stuck.ref } }), () => wdCheck(stuck.id))).json()).status, 'Rejected')
  })
})

test('suspended agent: cash approval is refused; bank still works; reject still works', async () => {
  await whileSuspended(async () => {
    const cashPlan = await mkPlan(10000)
    const cash = await mkRedemption({ planId: cashPlan })
    const m0 = await money()
    const res = await approve(cash.id)
    assert.equal(res.status, 409)
    assert.match((await res.json()).error, /cash can’t be paid through them/)
    assert.equal((await planRow(cashPlan)).balance, 10000)
    assert.deepEqual(await money(), m0)
    const { records } = await (await adminList.GET()).json()
    assert.equal(records.find((x: { id: string }) => x.id === cash.id).agentActive, false)
    assert.equal((await reject(cash.id)).status, 200)
    const bankPlan = await mkPlan(10000)
    const bank = await mkRedemption({ planId: bankPlan, method: 'BankTransfer' })
    assert.equal((await approve(bank.id)).status, 200)
    assert.equal((await erRow(bank.id)).status, 'Approved')
  })
})

test('suspended agent: a customer can\'t ask for cash, and an active agent\'s customer still can', async () => {
  const planId = await mkPlan(10000)
  await prisma.savingsPlan.update({ where: { id: planId }, data: { startDate: new Date(Date.now() + 3 * 864e5) } })
  await whileSuspended(async () => {
    const res = await redeemRoute.POST({ json: async () => ({ reason: 'x' }), headers: new Headers() } as never)
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /choose a bank account/)
  })
  const ok = await redeemRoute.POST({ json: async () => ({ reason: 'x' }), headers: new Headers() } as never)
  assert.equal(ok.status, 200)
  const { ref } = await ok.json()
  refs.push(ref)
  erIds.push((await prisma.earlyRedemption.findUniqueOrThrow({ where: { ref } })).id)
  await prisma.savingsPlan.update({ where: { id: planId }, data: { status: 'Completed' } })
})

test('suspended agent: old links stop enrolling, with the page told up front', async () => {
  const email = `rg-enrol-${RUN}@test.local`
  const url = (q: string) => ({ url: `http://x/api/customer/enroll/invite?${q}`, headers: new Headers({ 'x-forwarded-for': `10.9.${seq.n++}.1` }) }) as never
  const body = { aid: agentCode, firstName: 'Ada', lastName: 'Obi', phone: `0809${String(Date.now()).slice(-7)}`, email, address: '12 Allen Avenue, Ikeja', nokName: 'N', nokRelation: 'R', nokPhone: '08090001122', password: 'secret1', gender: 'Female', state: 'Lagos', lga: 'Ikeja', dailyAmount: 500, periodDays: 90, goal: 'Rent' }
  const post = () => enrollRoute.POST({ json: async () => body, headers: new Headers({ 'x-forwarded-for': `10.8.${seq.n++}.1` }) } as never)
  await whileSuspended(async () => {
    assert.equal((await inviteRoute.GET(url(`aid=${agentCode}`))).status, 410)
    const res = await post()
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /no longer active/)
    assert.equal(await prisma.customer.count({ where: { email } }), 0)
  })
  assert.equal((await inviteRoute.GET(url(`aid=${agentCode}`))).status, 200)
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

async function codedRequest(code: string, tokenExpiry = new Date(Date.now() + 60_000)) {
  const planId = await mkPlan(10000)
  const r = await mkRedemption({ planId, status: 'Pending', tokenExpiry })
  await prisma.earlyRedemption.update({ where: { id: r.id }, data: { token: hashRedemptionToken(code) } })
  return { planId, r }
}
const uniqueCode = () => String(100000 + Math.floor(Math.random() * 899999))
const checkWithRef = (ref: string, token: string) => verifyToken.POST({ json: async () => ({ ref, token }) } as never)
const checkCodeOnly = (token: string) => lookupToken.POST({ json: async () => ({ token }), headers: new Headers() } as never)

test('agent flow: a correct code sends the request to the admin, who can then pay it', async () => {
  const code = uniqueCode()
  const { planId, r } = await codedRequest(code)
  asAgent()
  const notices = adminNotices
  const res = await checkWithRef(r.ref, code)
  assert.equal((await res.json()).valid, true)
  const row = await erRow(r.id)
  assert.equal(row.status, 'AgentApproved')
  assert.ok(row.agentApprovedAt)
  assert.equal(row.agentApprovedBy, agentCode)
  assert.equal(adminNotices, notices + 1, 'super admins told')
  await new Promise(done => setTimeout(done, 100)) // logAudit is fire-and-forget
  const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'agent_redemption_code_confirmed', entityId: r.id } })
  assert.equal(log.actorId, agentId)
  asAdmin()
  assert.equal((await approve(r.id)).status, 200)
  assert.equal((await planRow(planId)).balance, 0)
})

test('agent flow by code alone: the same, so nothing sits with the admin unapprovable', async () => {
  const code = uniqueCode()
  const { r } = await codedRequest(code)
  asAgent()
  const notices = adminNotices
  assert.equal((await (await checkCodeOnly(code)).json()).valid, true)
  assert.equal((await erRow(r.id)).status, 'AgentApproved')
  assert.equal((await erRow(r.id)).agentApprovedBy, agentCode)
  assert.equal(adminNotices, notices + 1)
  asAdmin()
  assert.equal((await approve(r.id)).status, 200)
})

test('a confirmed request no longer counts as abandoned once its code time passes', async () => {
  const code = uniqueCode()
  const { planId, r } = await codedRequest(code)
  asAgent()
  await checkWithRef(r.ref, code)
  await prisma.earlyRedemption.update({ where: { id: r.id }, data: { tokenExpiry: new Date(Date.now() - 60_000) } })
  assert.equal(await hasOpenRedemption(prisma, planId), true)
})

test('a wrong or expired code confirms nothing', async () => {
  const code = uniqueCode()
  const { r } = await codedRequest(code)
  asAgent()
  assert.equal((await (await checkWithRef(r.ref, '000000')).json()).valid, false)
  assert.equal((await (await checkCodeOnly('000001')).json()).valid, false)
  assert.equal((await erRow(r.id)).status, 'Pending')
  const expiredCode = uniqueCode()
  const expired = await codedRequest(expiredCode, new Date(Date.now() - 60_000))
  assert.equal((await (await checkWithRef(expired.r.ref, expiredCode)).json()).valid, false)
  assert.equal((await (await checkCodeOnly(expiredCode)).json()).valid, false)
  assert.equal((await erRow(expired.r.id)).status, 'Pending')
})

const lookupKey = () => `redeem-lookup:agent:${agentId}`
const lookupAudits = () => prisma.auditLog.count({ where: { action: 'redemption_code_lookup_limit', entityId: agentId, createdAt: { gte: suiteStart } } })

test('code lookups are capped per agent: even a correct code is refused over the cap, with one alert', async () => {
  await prisma.loginAttempt.deleteMany({ where: { key: lookupKey() } })
  const before = await lookupAudits()
  const code = uniqueCode()
  const { r } = await codedRequest(code)
  asAgent()
  for (let i = 0; i < CODE_LOOKUPS_PER_HOUR; i++) {
    const res = await checkCodeOnly('000001')
    assert.equal(res.status, 200, `lookup ${i}`)
    assert.equal((await res.json()).valid, false)
  }
  for (let i = 0; i < 3; i++) {
    const res = await checkCodeOnly(code)
    assert.equal(res.status, 429)
    assert.match((await res.json()).error, /Too many code lookups/)
  }
  assert.equal((await erRow(r.id)).status, 'Pending', 'not confirmed')
  assert.equal(await lookupAudits(), before + 1, 'one alert, not one per guess')
  await prisma.loginAttempt.deleteMany({ where: { key: lookupKey() } })
  assert.equal((await (await checkCodeOnly(code)).json()).valid, true, 'works again once the window has reset')
  await prisma.loginAttempt.deleteMany({ where: { key: lookupKey() } })
})

test('the code lookup cap holds under concurrency, is per agent, and opens again after the hour', async () => {
  const t0 = new Date('2026-11-02T10:00:00.000Z')
  const first = `cap-a-${RUN}`
  const second = `cap-b-${RUN}`
  try {
    const results = await Promise.all(Array.from({ length: CODE_LOOKUPS_PER_HOUR + 6 }, () => spendCodeLookup(prisma, first, t0)))
    assert.equal(results.filter(r => r.allowed).length, CODE_LOOKUPS_PER_HOUR)
    assert.equal(results.filter(r => r.firstRefusal).length, 1)
    assert.equal((await spendCodeLookup(prisma, second, t0)).allowed, true)
    assert.equal((await spendCodeLookup(prisma, first, new Date(t0.getTime() + 59 * 60_000))).allowed, false)
    assert.equal((await spendCodeLookup(prisma, first, new Date(t0.getTime() + 61 * 60_000))).allowed, true)
  } finally {
    await prisma.loginAttempt.deleteMany({ where: { key: { in: [`redeem-lookup:agent:${first}`, `redeem-lookup:agent:${second}`] } } })
  }
})

test('the ref-based code check has its own per-request cap and is not limited by lookups', async () => {
  await prisma.loginAttempt.deleteMany({ where: { key: lookupKey() } })
  for (let i = 0; i < CODE_LOOKUPS_PER_HOUR + 1; i++) await spendCodeLookup(prisma, agentId)
  const code = uniqueCode()
  const { r } = await codedRequest(code)
  asAgent()
  assert.equal((await (await checkWithRef(r.ref, code)).json()).valid, true)
  await prisma.loginAttempt.deleteMany({ where: { key: lookupKey() } })
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

  const listed = await (await redeemRoute.GET(new NextRequest('http://localhost/api/customer/redeem'))).json()
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
