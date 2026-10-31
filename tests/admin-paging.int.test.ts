// Admin transactions + audit paging. Session is stubbed like savings-interest-admin.int.test.ts.
// Rows are tagged with a run id (transaction.type / audit.action) and deleted by id afterwards.
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { prisma } from '../src/lib/prisma'

const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => null }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tx = require('../src/app/api/admin/transactions/route') as typeof import('../src/app/api/admin/transactions/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const audit = require('../src/app/api/admin/audit/route') as typeof import('../src/app/api/admin/audit/route')

const RUN = `pg${Math.random().toString(36).slice(2, 10)}`
const N = 25
let agentDbId = ''
const auditIds: string[] = []

function actAs(user: { id: string; role?: string } | null) {
  stub.getServerSession = async () => (user ? { user: { name: 'Test Admin', ...user } } : null)
}
const req = (qs: string) => ({ url: `http://x/api?${qs}` }) as never

beforeEach(() => actAs({ id: RUN, role: 'superadmin' }))

after(async () => {
  M._load = realLoad
  await prisma.transaction.deleteMany({ where: { type: RUN } })
  if (agentDbId) await prisma.agent.delete({ where: { id: agentDbId } })
  await prisma.auditLog.deleteMany({ where: { id: { in: auditIds } } })
  await prisma.$disconnect()
})

test('setup', async () => {
  const a = await prisma.agent.create({
    data: { agentId: `T${RUN}`, phone: `0${Date.now()}`.slice(0, 11) + RUN, name: 'Paging Test', location: 'x', password: 'x' },
  })
  agentDbId = a.id
  for (let i = 0; i < N; i++) {
    await prisma.transaction.create({
      data: { ref: `${RUN}-${i}`, agentId: a.id, type: RUN, amount: i + 1, createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, i)) },
    })
    const l = await prisma.auditLog.create({
      data: { action: RUN, entity: 'paging', details: `d${i}`, createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, i)) },
    })
    auditIds.push(l.id)
  }
})

test('transactions: page=2&limit=10 returns the right slice and filtered total', async () => {
  const res = await tx.GET(req(`type=${RUN}&page=2&limit=10`))
  assert.equal(res.status, 200)
  const b = (await res.json()) as { transactions: { amount: number }[]; total: number; page: number; limit: number }
  assert.equal(b.total, N)
  assert.equal(b.page, 2)
  assert.equal(b.limit, 10)
  // newest first: amounts 25..16 on page 1, 15..6 on page 2
  assert.deepEqual(b.transactions.map(t => t.amount), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6])
  const last = (await (await tx.GET(req(`type=${RUN}&page=3&limit=10`))).json()) as { transactions: unknown[] }
  assert.equal(last.transactions.length, 5)
})

test('transactions: no paging params keeps shape, adds total', async () => {
  const res = await tx.GET(req(`type=${RUN}`))
  assert.equal(res.status, 200)
  const b = (await res.json()) as { transactions: unknown[]; total: number }
  assert.equal(b.transactions.length, N)
  assert.equal(b.total, N)
  const bare = (await (await tx.GET(req(''))).json()) as { transactions: unknown[]; total: number }
  assert.ok(bare.transactions.length <= 200)
  assert.ok(bare.total >= N)
})

test('transactions: bad paging values fall back to defaults and limit is clamped', async () => {
  for (const qs of ['page=abc&limit=-5', 'page=0&limit=0', 'page=1.5&limit=NaN']) {
    const res = await tx.GET(req(`type=${RUN}&${qs}`))
    assert.equal(res.status, 200, qs)
    const b = (await res.json()) as { transactions: unknown[]; page: number }
    assert.equal(b.page, 1)
    assert.equal(b.transactions.length, N)
  }
  const big = (await (await tx.GET(req(`type=${RUN}&limit=99999`))).json()) as { limit: number }
  assert.equal(big.limit, 200)
})

test('audit: page=2&limit=10 returns the right slice and filtered total', async () => {
  const res = await audit.GET(req(`action=${RUN}&page=2&limit=10`))
  assert.equal(res.status, 200)
  const b = (await res.json()) as { logs: { details: string }[]; total: number; page: number; limit: number }
  assert.equal(b.total, N)
  assert.equal(b.page, 2)
  assert.deepEqual(b.logs.map(l => l.details), ['d14', 'd13', 'd12', 'd11', 'd10', 'd9', 'd8', 'd7', 'd6', 'd5'])
})

test('audit: no paging params keeps shape, adds total; bad values do not 500', async () => {
  const b = (await (await audit.GET(req(`action=${RUN}`))).json()) as { logs: unknown[]; total: number }
  assert.equal(b.logs.length, N)
  assert.equal(b.total, N)
  const bad = await audit.GET(req(`action=${RUN}&page=-3&limit=zzz`))
  assert.equal(bad.status, 200)
})

test('both enforce requireSuperAdmin (401 anon, 403 agent role)', async () => {
  for (const h of [tx.GET, audit.GET]) {
    actAs(null)
    assert.equal((await h(req('page=1'))).status, 401)
    actAs({ id: 'a1', role: 'agent' })
    assert.equal((await h(req('page=1'))).status, 403)
  }
})
