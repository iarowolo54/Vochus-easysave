// Item 23: finalize-otp routes must be single-shot (claim AwaitingOTP, then finalize/credit).
// Real prisma; rows scoped by a run id and removed by id. sk_test_ key makes paystack short-circuit.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'

process.env.PAYSTACK_SECRET_KEY = 'sk_test_finalize_otp_races'

const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => null }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
/* eslint-disable @typescript-eslint/no-require-imports */
const { loadOwnedRedeemablePlan } = require('../src/lib/redemption') as typeof import('../src/lib/redemption')
const { prisma } = require('../src/lib/prisma') as typeof import('../src/lib/prisma')
const wdFin = require('../src/app/api/admin/agent-withdrawal/[id]/finalize-otp/route') as typeof import('../src/app/api/admin/agent-withdrawal/[id]/finalize-otp/route')
const erFin = require('../src/app/api/admin/early-redemption/[id]/finalize-otp/route') as typeof import('../src/app/api/admin/early-redemption/[id]/finalize-otp/route')
/* eslint-enable @typescript-eslint/no-require-imports */

const rid = Math.random().toString(36).slice(2, 8)
let adminId = ''
let agentId = ''
let customerId = ''
const planIds: string[] = []
const wdIds: string[] = []
const erIds: string[] = []
const refs: string[] = []
let revenueBefore: number | null = null

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const wdFinalize = (id: string) => wdFin.POST({ json: async () => ({ otp: '123456' }) } as never, ctx(id))
const erFinalize = (id: string) => erFin.POST({ json: async () => ({ otp: '123456' }) } as never, ctx(id))
const agentRow = () => prisma.agent.findUniqueOrThrow({ where: { id: agentId } })
const revenue = async () => (await prisma.platformWallet.findUnique({ where: { type: 'Revenue' } }))?.balance ?? 0
const auditCount = async (entityId: string) => {
  await new Promise((r) => setTimeout(r, 150)) // logAudit is fire-and-forget
  return prisma.auditLog.count({ where: { entityId } })
}

async function mkWithdrawal() {
  const ref = `WDF-${rid}-${wdIds.length}`
  refs.push(ref)
  const w = await prisma.agentWithdrawal.create({
    data: { ref, agentId, amount: 500, status: 'AwaitingOTP', paystackTransferCode: `TRF_${rid}_${wdIds.length}` },
  })
  wdIds.push(w.id)
  return w
}
async function mkRedemption(planStatus = 'Redeemed') {
  const p = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 1e10), balance: planStatus === 'Redeemed' ? 0 : 1000, status: planStatus, source: 'agent' },
  })
  planIds.push(p.id)
  const ref = `ERF-${rid}-${erIds.length}`
  refs.push(ref)
  const r = await prisma.earlyRedemption.create({
    data: {
      ref, savingsPlanId: p.id, reason: 'x', status: 'AwaitingOTP', balance: 1000, penalty: 100, netPayout: 900,
      payoutMethod: 'BankTransfer', accountNumber: '0123456789', bankCode: '001', accountName: 'Test Account',
      paystackTransferCode: `TRF_${rid}_ER${erIds.length}`,
    },
  })
  erIds.push(r.id)
  return r
}

before(async () => {
  adminId = (await prisma.superAdmin.create({ data: { email: `fo-${rid}@test.local`, password: 'x', name: 'FO Admin' } })).id
  agentId = (await prisma.agent.create({ data: { agentId: `FO-${rid}`, phone: `0796${rid}`, name: 'A', location: 'x', password: 'x', commissionBalance: 0, walletBalance: 0 } })).id
  customerId = (await prisma.customer.create({
    data: { customerId: `FO-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `07${rid}3`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })).id
  revenueBefore = (await prisma.platformWallet.findUnique({ where: { type: 'Revenue' } }))?.balance ?? null
  await prisma.platformWallet.upsert({ where: { type: 'Revenue' }, update: { balance: { increment: 0 } }, create: { type: 'Revenue', balance: 0 } })
})

beforeEach(() => {
  stub.getServerSession = async () => ({ user: { id: adminId, name: 'FO Admin', role: 'superadmin' } })
})

after(async () => {
  M._load = realLoad
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...wdIds, ...erIds] } } })
  await prisma.transaction.deleteMany({ where: { OR: [{ agentId }, { ref: { in: refs } }, { ref: { in: refs.map((r) => `${r}-INT`) } }] } })
  await prisma.earlyRedemption.deleteMany({ where: { id: { in: erIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.agentWithdrawal.deleteMany({ where: { id: { in: wdIds } } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.superAdmin.deleteMany({ where: { id: adminId } })
  if (revenueBefore === null) await prisma.platformWallet.deleteMany({ where: { type: 'Revenue' } })
  else await prisma.platformWallet.update({ where: { type: 'Revenue' }, data: { balance: revenueBefore } })
  await prisma.$disconnect()
})

test('withdrawal finalize-otp: concurrent double submit -> one 200, one 409, one audit', async () => {
  const w = await mkWithdrawal()
  const [a, b] = await Promise.all([wdFinalize(w.id), wdFinalize(w.id)])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
  const row = await prisma.agentWithdrawal.findUniqueOrThrow({ where: { id: w.id } })
  assert.equal(row.status, 'Approved')
  assert.equal(await auditCount(w.id), 1)
})

test('withdrawal finalize-otp: sequential second submit -> 409, single audit', async () => {
  const w = await mkWithdrawal()
  assert.equal((await wdFinalize(w.id)).status, 200)
  assert.equal((await wdFinalize(w.id)).status, 409)
  assert.equal(await auditCount(w.id), 1)
})

test('redemption finalize-otp: concurrent double submit credits exactly once', async () => {
  const r = await mkRedemption()
  const rev0 = await revenue()
  const comm0 = (await agentRow()).commissionBalance
  const [a, b] = await Promise.all([erFinalize(r.id), erFinalize(r.id)])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 1)
  assert.equal((await prisma.earlyRedemption.findUniqueOrThrow({ where: { id: r.id } })).status, 'Approved')
  const rev1 = await revenue()
  const comm1 = (await agentRow()).commissionBalance
  assert.ok(rev1 > rev0 || comm1 > comm0)
  // second attempt must not have moved money again
  assert.equal(await auditCount(r.id), 1)
})

test('redemption finalize-otp: sequential second submit -> 409, balances unchanged', async () => {
  const r = await mkRedemption()
  assert.equal((await erFinalize(r.id)).status, 200)
  const rev = await revenue()
  const comm = (await agentRow()).commissionBalance
  assert.equal((await erFinalize(r.id)).status, 409)
  assert.equal(await revenue(), rev)
  assert.equal((await agentRow()).commissionBalance, comm)
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 1)
})

// ---------- failure paths: drive the REAL paystack lib by stubbing fetch under a non-test key ----------
const realFetch = globalThis.fetch
const realKey = process.env.PAYSTACK_SECRET_KEY
function paystackReplies(impl: () => Promise<Response>) {
  process.env.PAYSTACK_SECRET_KEY = 'sk_live_stubbed'
  globalThis.fetch = (async () => impl()) as typeof fetch
}
function restorePaystack() {
  globalThis.fetch = realFetch
  process.env.PAYSTACK_SECRET_KEY = realKey
}
const reject = () => Promise.resolve(new Response(JSON.stringify({ status: false, message: 'Invalid OTP' }), { status: 200 }))
const transportFail = () => Promise.reject(new TypeError('fetch failed'))

test('withdrawal: definite Paystack rejection releases claim; retry then pays exactly once', async () => {
  const w = await mkWithdrawal()
  paystackReplies(reject)
  try {
    assert.equal((await wdFinalize(w.id)).status, 400)
  } finally { restorePaystack() }
  assert.equal((await prisma.agentWithdrawal.findUniqueOrThrow({ where: { id: w.id } })).status, 'AwaitingOTP')
  assert.equal(await auditCount(w.id), 0)
  assert.equal((await wdFinalize(w.id)).status, 200)
  assert.equal((await wdFinalize(w.id)).status, 409)
  assert.equal(await auditCount(w.id), 1)
})

test('withdrawal: transport error leaves Finalizing (502), no retry possible, nothing paid', async () => {
  const w = await mkWithdrawal()
  paystackReplies(transportFail)
  try {
    assert.equal((await wdFinalize(w.id)).status, 502)
  } finally { restorePaystack() }
  const row = await prisma.agentWithdrawal.findUniqueOrThrow({ where: { id: w.id } })
  assert.equal(row.status, 'Finalizing')
  assert.equal(await auditCount(w.id), 0)
  assert.equal((await wdFinalize(w.id)).status, 409)
})

test('redemption: definite rejection releases claim, nothing paid, retry pays once', async () => {
  const r = await mkRedemption()
  const rev0 = await revenue()
  const comm0 = (await agentRow()).commissionBalance
  paystackReplies(reject)
  try {
    assert.equal((await erFinalize(r.id)).status, 400)
  } finally { restorePaystack() }
  assert.equal((await prisma.earlyRedemption.findUniqueOrThrow({ where: { id: r.id } })).status, 'AwaitingOTP')
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 0)
  assert.equal(await revenue(), rev0)
  assert.equal((await agentRow()).commissionBalance, comm0)
  assert.equal((await erFinalize(r.id)).status, 200)
  assert.equal((await erFinalize(r.id)).status, 409)
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 1)
})

test('redemption: transport error leaves Finalizing, nothing paid, and the plan is NOT redeemable again', async () => {
  const r = await mkRedemption('Active')
  const rev0 = await revenue()
  paystackReplies(transportFail)
  try {
    assert.equal((await erFinalize(r.id)).status, 502)
  } finally { restorePaystack() }
  assert.equal((await prisma.earlyRedemption.findUniqueOrThrow({ where: { id: r.id } })).status, 'Finalizing')
  assert.equal(await prisma.transaction.count({ where: { ref: r.ref } }), 0)
  assert.equal(await revenue(), rev0)
  // double-pay window closed: the agent-direct path must not see this plan as redeemable
  assert.equal(await loadOwnedRedeemablePlan(agentId, customerId, r.savingsPlanId), null)
  assert.equal((await erFinalize(r.id)).status, 409)
  // control: once the redemption is no longer in flight the plan is redeemable again
  await prisma.earlyRedemption.update({ where: { id: r.id }, data: { status: 'Rejected' } })
  assert.ok(await loadOwnedRedeemablePlan(agentId, customerId, r.savingsPlanId))
})
