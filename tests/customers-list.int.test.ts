// GET /api/customers (agent session): type, lastPaidAt, ?type / ?sort=lastPaid / ?plan filters
// applied before paging, and the offline collection summary. getServerSession is stubbed on the
// next-auth module load (same approach as savings-interest-admin). Rows are scoped to a unique
// agent and cleaned up by id.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { prisma } from '../src/lib/prisma'

const rid = Math.random().toString(36).slice(2, 10)
const aid = `CL-${rid}`
const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => ({ user: { agentId: aid } }) }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('../src/app/api/customers/route') as typeof import('../src/app/api/customers/route')

type Row = { id: string; customerId: string; type: string; lastPaidAt: string | null; password?: unknown }
type Body = { customers: Row[]; total: number; summary?: { overdueCount: number; expectedToday: number; saverCount: number } }
const call = async (qs = '') => {
  const res = await GET({ url: `http://x/api/customers${qs}` } as never)
  return { status: res.status, body: (await res.json()) as Body }
}

const DAY = 86_400_000
let agentDbId = '', otherAgentId = ''
const cid: Record<string, string> = {}
const custIds: string[] = []

async function mk(key: string, o: { n: number; source?: string; cadence?: string; daily: number; days?: number; paidAgo?: number | null; status?: string; agent?: string }) {
  const c = await prisma.customer.create({
    data: {
      customerId: `T${rid}${key}`, agentId: o.agent ?? agentDbId, firstName: key, lastName: 'T', phone: `09${rid}${key}`,
      address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0', password: 'HASH',
      createdAt: new Date(Date.now() - o.n * 3600_000),
    },
  })
  custIds.push(c.id); cid[key] = c.id
  const plan = await prisma.savingsPlan.create({
    data: {
      customerId: c.id, dailyAmount: o.daily, periodDays: o.days ?? 30, cadence: o.cadence ?? 'daily', source: o.source ?? 'agent',
      goal: 'g', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * DAY), status: o.status ?? 'Active',
    },
  })
  if (o.paidAgo !== undefined && o.paidAgo !== null) {
    await prisma.transaction.create({
      data: { ref: `TX${rid}${key}`, agentId: agentDbId, customerId: c.id, planId: plan.id, type: 'saving', amount: o.daily, status: 'Done', createdAt: new Date(Date.now() - o.paidAgo) },
    })
  }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: aid, phone: `0751${rid}`, name: 'A', location: 'L', password: 'x' } })
  const b = await prisma.agent.create({ data: { agentId: `${aid}b`, phone: `0752${rid}`, name: 'B', location: 'L', password: 'x' } })
  agentDbId = a.id; otherAgentId = b.id
  await mk('A', { n: 1, daily: 100 })                                   // offline, never paid
  await mk('B', { n: 2, daily: 200, paidAgo: 1 * DAY })                 // offline, 1 day ago
  await mk('C', { n: 3, daily: 300, paidAgo: 5 * DAY })                 // offline, 5 days ago (overdue)
  await mk('D', { n: 4, daily: 500, cadence: 'weekly', paidAgo: 0 })    // offline, weekly, paid now
  await mk('E', { n: 5, daily: 50, source: 'self', days: 90, paidAgo: 2 * DAY }) // online
  await mk('Z', { n: 6, daily: 999, agent: otherAgentId })              // other agent
})

after(async () => {
  M._load = realLoad
  await prisma.transaction.deleteMany({ where: { customerId: { in: custIds } } })
  await prisma.savingsPlan.deleteMany({ where: { customerId: { in: custIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: custIds } } })
  await prisma.agent.deleteMany({ where: { id: { in: [agentDbId, otherAgentId] } } })
  await prisma.$disconnect()
})

test('type=offline&sort=lastPaid: agent-created only, never-paid first, with summary', async () => {
  const { status, body } = await call('?type=offline&sort=lastPaid&limit=10')
  assert.equal(status, 200)
  assert.deepEqual(body.customers.map(c => c.id), [cid.A, cid.C, cid.B, cid.D])
  assert.equal(body.total, 4)
  assert.ok(body.customers.every(c => c.type === 'offline'))
  assert.equal(body.customers[0].lastPaidAt, null)
  assert.equal(typeof body.customers[1].lastPaidAt, 'string')
  assert.deepEqual(body.summary, { overdueCount: 2, expectedToday: 600, saverCount: 4 })
})

test('summary ignores search/page/limit', async () => {
  const { body } = await call(`?type=offline&limit=1&page=1&search=${rid}B`)
  assert.equal(body.customers.length, 1)
  assert.deepEqual(body.summary, { overdueCount: 2, expectedToday: 600, saverCount: 4 })
})

test('sort=lastPaid pages correctly', async () => {
  const p2 = await call('?type=offline&sort=lastPaid&limit=2&page=2')
  assert.deepEqual(p2.body.customers.map(c => c.id), [cid.B, cid.D])
  assert.equal(p2.body.total, 4)
})

test('type=online: self-enrolled only, no summary', async () => {
  const { body } = await call('?type=online')
  assert.deepEqual(body.customers.map(c => c.id), [cid.E])
  assert.equal(body.customers[0].type, 'online')
  assert.equal(body.total, 1)
  assert.equal('summary' in body, false)
})

test('no params: all own customers, type + lastPaidAt present, no password, no summary', async () => {
  const { body } = await call()
  assert.equal(body.total, 5)
  assert.deepEqual(body.customers.map(c => c.id), [cid.A, cid.B, cid.C, cid.D, cid.E]) // createdAt desc
  for (const c of body.customers) {
    assert.ok(c.type === 'offline' || c.type === 'online')
    assert.ok('lastPaidAt' in c)
    assert.equal('password' in c, false)
  }
  assert.equal('summary' in body, false)
})

test('plan filter is applied before paging (total + page size correct)', async () => {
  const { body } = await call('?plan=30&limit=2')
  assert.equal(body.total, 4)
  assert.equal(body.customers.length, 2)
  const p90 = await call('?plan=90&limit=1')
  assert.deepEqual(p90.body.customers.map(c => c.id), [cid.E])
  assert.equal(p90.body.total, 1)
})

test('search=<cid>&limit=1 lookup still works', async () => {
  const { body } = await call(`?search=T${rid}C&limit=1`)
  assert.equal(body.customers.length, 1)
  assert.equal(body.customers[0].id, cid.C)
})
