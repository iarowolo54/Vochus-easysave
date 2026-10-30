// Handoff item 23: small admin-API gaps. getServerSession is stubbed via a module-load hook
// (see savings-interest-admin.int.test.ts). Rows are scoped by a run id and cleaned up by id only.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { prisma } from '../src/lib/prisma'

const rid = Math.random().toString(36).slice(2, 8)
const ADMIN_ID = `adm-${rid}`
const ADMIN_NAME = `Admin ${rid}`
const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => ({ user: { id: ADMIN_ID, name: ADMIN_NAME, role: 'superadmin' } }) }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
/* eslint-disable @typescript-eslint/no-require-imports */
const approve = (require('../src/app/api/admin/loans/[id]/approve/route') as typeof import('../src/app/api/admin/loans/[id]/approve/route')).PATCH
const reject = (require('../src/app/api/admin/loans/[id]/reject/route') as typeof import('../src/app/api/admin/loans/[id]/reject/route')).PATCH
const gen = (require('../src/app/api/admin/cards/generate/route') as typeof import('../src/app/api/admin/cards/generate/route')).POST
const wallets = (require('../src/app/api/admin/wallets/route') as typeof import('../src/app/api/admin/wallets/route')).GET
const commission = (require('../src/app/api/admin/commission/route') as typeof import('../src/app/api/admin/commission/route')).GET
const fund = (require('../src/app/api/admin/wallets/fund/route') as typeof import('../src/app/api/admin/wallets/fund/route')).POST
const custStatus = (require('../src/app/api/admin/customers/[id]/status/route') as typeof import('../src/app/api/admin/customers/[id]/status/route')).PATCH
const resetDev = (require('../src/app/api/admin/agents/[id]/reset-device/route') as typeof import('../src/app/api/admin/agents/[id]/reset-device/route')).POST
const rewardRoute = require('../src/app/api/admin/rewards/[id]/route') as typeof import('../src/app/api/admin/rewards/[id]/route')
const reportStatus = (require('../src/app/api/admin/reports/[id]/status/route') as typeof import('../src/app/api/admin/reports/[id]/status/route')).PATCH
/* eslint-enable @typescript-eslint/no-require-imports */

let agentId = '', custId = ''
const loanIds: string[] = []
const batchIds: string[] = []
const P = (id: string) => ({ params: Promise.resolve({ id }) })
const jsonReq = (body: unknown) => ({ json: async () => body }) as never
const badReq = () => ({ json: async () => { throw new SyntaxError('bad json') } }) as never

async function auditFor(entityId: string, action: string) {
  for (let i = 0; i < 40; i++) {
    const row = await prisma.auditLog.findFirst({ where: { entityId, action } })
    if (row) return row
    await new Promise(r => setTimeout(r, 25))
  }
  return null
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `AG${rid}`, phone: `0771${rid}`, name: 'A', location: 'L', password: 'x', photoUrl: 'data:image/png;base64,AAAA', walletBalance: 0 } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `AG${rid}`, agentId, firstName: 'F', lastName: 'L', phone: `0772${rid}`, address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0', password: 'HASH', gender: 'Female', state: 'Lagos', lga: 'Ikeja' },
  })
  custId = c.id
})

after(async () => {
  M._load = realLoad
  const entityIds = [...loanIds, ...batchIds, agentId, custId]
  await prisma.auditLog.deleteMany({ where: { entityId: { in: entityIds } } }).catch(() => {})
  await prisma.transaction.deleteMany({ where: { agentId } })
  if (loanIds.length) await prisma.loan.deleteMany({ where: { id: { in: loanIds } } })
  if (batchIds.length) await prisma.memberCard.deleteMany({ where: { batchId: { in: batchIds } } })
  await prisma.customer.delete({ where: { id: custId } })
  await prisma.agent.delete({ where: { id: agentId } })
  await prisma.$disconnect()
})

async function mkLoan() {
  const l = await prisma.loan.create({
    data: { ref: `AG${rid}-${loanIds.length}`, agentId, customerId: custId, principal: 1000, interestRate: 10, interestAmount: 100, totalAmount: 1100, durationDays: 30, dueDate: new Date(Date.now() + 86400000), status: 'Pending' },
  })
  loanIds.push(l.id)
  return l.id
}

test('loan approve audit carries the real admin id + name', async () => {
  const id = await mkLoan()
  assert.equal((await approve({} as never, P(id))).status, 200)
  const row = await auditFor(id, 'loan_approve')
  assert.equal(row?.actorId, ADMIN_ID)
  assert.equal(row?.actorName, ADMIN_NAME)
})

test('loan reject audit carries the real admin id + name', async () => {
  const id = await mkLoan()
  assert.equal((await reject({} as never, P(id))).status, 200)
  const row = await auditFor(id, 'loan_reject')
  assert.equal(row?.actorId, ADMIN_ID)
  assert.equal(row?.actorName, ADMIN_NAME)
})

test('card batch generate audit carries the real admin id + name', async () => {
  const res = await gen(jsonReq({ batchName: `B${rid}`, quantity: 1, expiryDate: new Date(Date.now() + 86400000 * 30).toISOString() }))
  assert.equal(res.status, 201)
  const { batchId } = (await res.json()) as { batchId: string }
  batchIds.push(batchId)
  const row = await auditFor(batchId, 'card_batch_create')
  assert.equal(row?.actorId, ADMIN_ID)
  assert.equal(row?.actorName, ADMIN_NAME)
})

test('wallets and commission list rows carry no photoUrl', async () => {
  const w = (await (await wallets({} as never)).json()) as { agents: Record<string, unknown>[] }
  assert.ok(w.agents.some(a => a.id === agentId))
  assert.ok(w.agents.every(a => !('photoUrl' in a)))
  const c = (await (await commission()).json()) as { leaderboard: Record<string, unknown>[] }
  assert.ok(c.leaderboard.some(a => a.id === agentId))
  assert.ok(c.leaderboard.every(a => !('photoUrl' in a)))
})

test('wallet fund rejects non-numeric, non-finite, negative and over-limit amounts', async () => {
  for (const amount of ['500', NaN, Infinity, -5, 0, null, 1e12, 0.001]) {
    const r = await fund(jsonReq({ agentId, amount }))
    assert.equal(r.status, 400, `amount ${String(amount)}`)
  }
  assert.equal((await prisma.agent.findUniqueOrThrow({ where: { id: agentId } })).walletBalance, 0)
})

test('wallet fund still accepts a valid amount; malformed body is 400', async () => {
  assert.equal((await fund(badReq())).status, 400)
  const r = await fund(jsonReq({ agentId, amount: 1000 }))
  assert.equal(r.status, 200)
  assert.equal((await prisma.agent.findUniqueOrThrow({ where: { id: agentId } })).walletBalance, 1000)
})

test('customer status: bad body 400, unknown id 404', async () => {
  assert.equal((await custStatus(badReq(), P(custId))).status, 400)
  assert.equal((await custStatus(jsonReq({ status: 'Locked' }), P('nope-' + rid))).status, 404)
  assert.equal((await custStatus(jsonReq({ status: 'Active' }), P(custId))).status, 200)
})

test('reset-device: unknown id 404, real id 200 with real actor', async () => {
  assert.equal((await resetDev({} as never, P('nope-' + rid))).status, 404)
  assert.equal((await resetDev({} as never, P(agentId))).status, 200)
  const row = await auditFor(agentId, 'agent_reset_device')
  assert.equal(row?.actorId, ADMIN_ID)
})

test('rewards PATCH/DELETE: bad body 400, unknown id 404', async () => {
  assert.equal((await rewardRoute.PATCH(badReq(), { params: Promise.resolve({ id: 'x' }) })).status, 400)
  assert.equal((await rewardRoute.PATCH(jsonReq({ name: 'n' }), { params: Promise.resolve({ id: 'nope-' + rid }) })).status, 404)
  assert.equal((await rewardRoute.DELETE({} as never, { params: Promise.resolve({ id: 'nope-' + rid }) })).status, 404)
})

test('report status: bad body 400, unknown id 404', async () => {
  assert.equal((await reportStatus(badReq(), P('x'))).status, 400)
  assert.equal((await reportStatus(jsonReq({ status: 'Resolved' }), P('nope-' + rid))).status, 404)
})
