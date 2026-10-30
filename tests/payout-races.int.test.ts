// Item 21: money-moving admin routes must be single-shot (conditional claim, then pay) and the
// approval PIN must lock after repeated wrong attempts. Real prisma; every row is scoped by a
// run id and removed by id. PAYSTACK_SECRET_KEY=sk_test_ makes the paystack lib short-circuit.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import bcrypt from 'bcryptjs'

process.env.PAYSTACK_SECRET_KEY = 'sk_test_payout_races'

const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => null }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/lib/prisma') as typeof import('../src/lib/prisma')
const wd = require('../src/app/api/admin/agent-withdrawal/[id]/route') as typeof import('../src/app/api/admin/agent-withdrawal/[id]/route')
const wdVerify = require('../src/app/api/admin/agent-withdrawal/[id]/verify/route') as typeof import('../src/app/api/admin/agent-withdrawal/[id]/verify/route')
const er = require('../src/app/api/admin/early-redemption/[id]/route') as typeof import('../src/app/api/admin/early-redemption/[id]/route')
const cp = require('../src/app/api/admin/wallets/commission-payout/route') as typeof import('../src/app/api/admin/wallets/commission-payout/route')
/* eslint-enable @typescript-eslint/no-require-imports */

const rid = Math.random().toString(36).slice(2, 8)
const PIN = '482913'
let adminId = ''
let agentId = ''
let customerId = ''
const planIds: string[] = []
const wdIds: string[] = []
const erIds: string[] = []
const refs: string[] = []
let floatBefore: number | null = null
let revenueBefore: number | null = null

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const patch = (id: string, body: unknown) => wd.PATCH({ json: async () => body } as never, ctx(id))
const erPatch = (id: string, body: unknown) => er.PATCH({ json: async () => body } as never, ctx(id))
const verify = (id: string) => wdVerify.POST({} as never, ctx(id))
const payout = (body: unknown) => cp.POST({ json: async () => body } as never)
const agentRow = () => prisma.agent.findUniqueOrThrow({ where: { id: agentId } })
const walletBal = async (type: string) => (await prisma.platformWallet.findUnique({ where: { type } }))?.balance ?? null

async function mkWithdrawal(amount = 500) {
  const ref = `WD-${rid}-${wdIds.length}`
  refs.push(ref)
  const w = await prisma.agentWithdrawal.create({
    data: { ref, agentId, amount, status: 'Pending', accountNumber: '0123456789', bankCode: '001', accountName: 'Test Account' },
  })
  wdIds.push(w.id)
  return w
}
async function mkRedemption(opts: { method?: string } = {}) {
  const p = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 1e10), balance: 1000, status: 'PendingRedemption', source: 'agent' },
  })
  planIds.push(p.id)
  const ref = `ER-${rid}-${erIds.length}`
  refs.push(ref)
  const r = await prisma.earlyRedemption.create({
    data: {
      ref, savingsPlanId: p.id, reason: 'x', status: 'Pending', balance: 1000, penalty: 100, netPayout: 900,
      payoutMethod: opts.method ?? 'Cash', accountNumber: '0123456789', bankCode: '001', accountName: 'Test Account',
    },
  })
  erIds.push(r.id)
  return { r, planId: p.id }
}

before(async () => {
  const hash = await bcrypt.hash(PIN, 4)
  adminId = (await prisma.superAdmin.create({ data: { email: `pr-${rid}@test.local`, password: 'x', name: 'PR Admin', approvalPin: hash } })).id
  agentId = (await prisma.agent.create({ data: { agentId: `PR-${rid}`, phone: `0797${rid}`, name: 'A', location: 'x', password: 'x', commissionBalance: 0, walletBalance: 0 } })).id
  customerId = (await prisma.customer.create({
    data: { customerId: `PR-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `08${rid}2`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })).id
  floatBefore = await walletBal('Float')
  revenueBefore = await walletBal('Revenue')
  await prisma.platformWallet.upsert({ where: { type: 'Float' }, update: { balance: { increment: 100000 } }, create: { type: 'Float', balance: 100000 } })
  await prisma.platformWallet.upsert({ where: { type: 'Revenue' }, update: { balance: { increment: 0 } }, create: { type: 'Revenue', balance: 0 } })
})

beforeEach(async () => {
  stub.getServerSession = async () => ({ user: { id: adminId, name: 'PR Admin', role: 'superadmin' } })
  await prisma.auditLog.deleteMany({ where: { action: 'approval_pin_failed', actorId: adminId } })
})

after(async () => {
  M._load = realLoad
  await prisma.transaction.deleteMany({ where: { OR: [{ agentId }, { ref: { in: refs } }, { ref: { in: refs.map((r) => `${r}-INT`) } }] } })
  await prisma.earlyRedemption.deleteMany({ where: { id: { in: erIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.agentWithdrawal.deleteMany({ where: { id: { in: wdIds } } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.auditLog.deleteMany({ where: { actorId: adminId } })
  await prisma.superAdmin.deleteMany({ where: { id: adminId } })
  if (floatBefore === null) await prisma.platformWallet.deleteMany({ where: { type: 'Float' } })
  else await prisma.platformWallet.update({ where: { type: 'Float' }, data: { balance: floatBefore } })
  if (revenueBefore === null) await prisma.platformWallet.deleteMany({ where: { type: 'Revenue' } })
  else await prisma.platformWallet.update({ where: { type: 'Revenue' }, data: { balance: revenueBefore } })
  await prisma.$disconnect()
})

// ---------- agent-withdrawal approve ----------

test('withdrawal approve: concurrent double approve -> exactly one wins, other 409', async () => {
  const w = await mkWithdrawal()
  const [a, b] = await Promise.all([patch(w.id, { action: 'approve', pin: PIN }), patch(w.id, { action: 'approve', pin: PIN })])
  const codes = [a.status, b.status].sort()
  assert.deepEqual(codes, [200, 409])
  const row = await prisma.agentWithdrawal.findUniqueOrThrow({ where: { id: w.id } })
  assert.equal(row.status, 'Approved')
  assert.ok(row.paystackTransferCode)
})

test('withdrawal approve: sequential second approve -> 409, record unchanged', async () => {
  const w = await mkWithdrawal()
  assert.equal((await patch(w.id, { action: 'approve', pin: PIN })).status, 200)
  const before = await prisma.agentWithdrawal.findUniqueOrThrow({ where: { id: w.id } })
  assert.equal((await patch(w.id, { action: 'approve', pin: PIN })).status, 409)
  const after = await prisma.agentWithdrawal.findUniqueOrThrow({ where: { id: w.id } })
  assert.equal(after.paystackTransferCode, before.paystackTransferCode)
  assert.equal(after.status, 'Approved')
})

test('withdrawal reject: concurrent double reject refunds exactly once', async () => {
  await prisma.agent.update({ where: { id: agentId }, data: { commissionBalance: 0 } })
  const w = await mkWithdrawal(500)
  const [a, b] = await Promise.all([patch(w.id, { action: 'reject' }), patch(w.id, { action: 'reject' })])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
  assert.equal((await agentRow()).commissionBalance, 500)
})

test('withdrawal approve: wrong PIN is locked after 5 attempts (even a correct PIN is then refused)', async () => {
  const w = await mkWithdrawal()
  for (let i = 0; i < 5; i++) assert.equal((await patch(w.id, { action: 'approve', pin: '000000' })).status, 403)
  assert.equal((await patch(w.id, { action: 'approve', pin: '000000' })).status, 429)
  assert.equal((await patch(w.id, { action: 'approve', pin: PIN })).status, 429)
  assert.equal((await prisma.agentWithdrawal.findUniqueOrThrow({ where: { id: w.id } })).status, 'Pending')
})

// ---------- agent-withdrawal verify (refund) ----------

test('withdrawal verify: failed transfer refund is applied at most once (concurrent + sequential)', async () => {
  await prisma.agent.update({ where: { id: agentId }, data: { commissionBalance: 0 } })
  const w = await mkWithdrawal(300)
  await prisma.agentWithdrawal.update({ where: { id: w.id }, data: { status: 'Processing', paystackTransferCode: 'TRF_x' } })
  const realFetch = globalThis.fetch
  // Non-test key so verifyTransfer hits fetch; fake a failed transfer.
  process.env.PAYSTACK_SECRET_KEY = 'live_like_key'
  globalThis.fetch = (async () => new Response(JSON.stringify({ status: true, data: { status: 'failed' } }))) as typeof fetch
  try {
    const [a, b] = await Promise.all([verify(w.id), verify(w.id)])
    assert.deepEqual([a.status, b.status].sort(), [200, 409])
    assert.equal((await verify(w.id)).status, 409)
  } finally {
    globalThis.fetch = realFetch
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_payout_races'
  }
  assert.equal((await agentRow()).commissionBalance, 300)
  assert.equal((await prisma.agentWithdrawal.findUniqueOrThrow({ where: { id: w.id } })).status, 'Rejected')
})

// ---------- early-redemption approve ----------

test('redemption approve (cash): concurrent double approve pays once', async () => {
  const { r, planId } = await mkRedemption()
  const w0 = (await agentRow()).walletBalance
  const rev0 = await walletBal('Revenue')
  const [a, b] = await Promise.all([erPatch(r.id, { action: 'approve', pin: PIN }), erPatch(r.id, { action: 'approve', pin: PIN })])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
  assert.equal((await agentRow()).walletBalance - w0, 900)
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 1)
  assert.equal(((await walletBal('Revenue')) ?? 0) - (rev0 ?? 0), 40)
  assert.equal((await prisma.earlyRedemption.findUniqueOrThrow({ where: { id: r.id } })).status, 'Approved')
  assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: planId } })).status, 'Redeemed')
})

test('redemption approve (cash): sequential second approve -> 409, no second movement', async () => {
  const { r } = await mkRedemption()
  assert.equal((await erPatch(r.id, { action: 'approve', pin: PIN })).status, 200)
  const w1 = (await agentRow()).walletBalance
  const c1 = (await agentRow()).commissionBalance
  assert.equal((await erPatch(r.id, { action: 'approve', pin: PIN })).status, 409)
  assert.equal((await agentRow()).walletBalance, w1)
  assert.equal((await agentRow()).commissionBalance, c1)
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 1)
})

test('redemption approve (bank): concurrent double approve starts one transfer and pays once', async () => {
  const { r } = await mkRedemption({ method: 'Bank Transfer' })
  const [a, b] = await Promise.all([erPatch(r.id, { action: 'approve', pin: PIN }), erPatch(r.id, { action: 'approve', pin: PIN })])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 1)
  assert.equal((await prisma.earlyRedemption.findUniqueOrThrow({ where: { id: r.id } })).status, 'Approved')
})

test('redemption reject: concurrent double reject -> one wins', async () => {
  const { r } = await mkRedemption()
  const [a, b] = await Promise.all([erPatch(r.id, { action: 'reject' }), erPatch(r.id, { action: 'reject' })])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
})

test('redemption approve: wrong PIN is locked after 5 attempts', async () => {
  const { r } = await mkRedemption()
  for (let i = 0; i < 5; i++) assert.equal((await erPatch(r.id, { action: 'approve', pin: '111111' })).status, 403)
  assert.equal((await erPatch(r.id, { action: 'approve', pin: PIN })).status, 429)
  assert.equal((await prisma.earlyRedemption.findUniqueOrThrow({ where: { id: r.id } })).status, 'Pending')
})

// ---------- commission payout ----------

test('commission payout: concurrent double payout debits Float and agent once', async () => {
  await prisma.agent.update({ where: { id: agentId }, data: { commissionBalance: 700 } })
  const f0 = (await walletBal('Float')) ?? 0
  const [a, b] = await Promise.all([payout({ agentId }), payout({ agentId })])
  const codes = [a.status, b.status].sort()
  assert.equal(codes[0], 200)
  assert.ok(codes[1] === 409 || codes[1] === 400, `second status ${codes[1]}`)
  assert.equal((await agentRow()).commissionBalance, 0)
  assert.equal(f0 - ((await walletBal('Float')) ?? 0), 700)
  assert.equal(await prisma.transaction.count({ where: { agentId, type: 'commission_payout' } }), 1)
  // sequential repeat moves nothing either
  assert.ok((await payout({ agentId })).status >= 400)
  assert.equal(await prisma.transaction.count({ where: { agentId, type: 'commission_payout' } }), 1)
})

test('commission payout: Float lacking funds -> 400, agent commission untouched', async () => {
  await prisma.agent.update({ where: { id: agentId }, data: { commissionBalance: 1e12 } })
  const res = await payout({ agentId })
  assert.equal(res.status, 400)
  assert.equal((await agentRow()).commissionBalance, 1e12)
  await prisma.agent.update({ where: { id: agentId }, data: { commissionBalance: 0 } })
})
