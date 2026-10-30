// GET /api/admin/customers (superadmin): type + lastPaidAt on every row, no photoUrl/password,
// gender/state/lga present, type agrees with /api/customers. getServerSession is stubbed at module
// load (same approach as savings-interest-admin). Rows are scoped by a unique run id, cleaned by id.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { prisma } from '../src/lib/prisma'

const rid = Math.random().toString(36).slice(2, 10)
const aid = `AC-${rid}`
const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => null }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('../src/app/api/admin/customers/route') as typeof import('../src/app/api/admin/customers/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET: agentGET } = require('../src/app/api/customers/route') as typeof import('../src/app/api/customers/route')

type Row = Record<string, unknown> & { id: string; type: string; lastPaidAt: string | null }
const actAs = (u: { id: string; role?: string } | null) => {
  stub.getServerSession = async () => (u ? { user: { name: 'T', ...u } } : null)
}
const call = async (qs = '') => GET({ url: `http://x/api/admin/customers${qs}` } as never)

let agentDbId = ''
const ids: Record<string, string> = {}
const custIds: string[] = []
const paidAt = new Date(Date.now() - 2 * 86_400_000)

async function mk(key: string, source: string, paid: boolean) {
  const c = await prisma.customer.create({
    data: {
      customerId: `T${rid}${key}`, agentId: agentDbId, firstName: key, lastName: 'T', phone: `09${rid}${key}`,
      address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0', password: 'HASH', photoUrl: 'data:image/png;base64,AAAA',
      gender: 'Female', state: 'Lagos', lga: 'Ikeja',
    },
  })
  custIds.push(c.id); ids[key] = c.id
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 30, cadence: 'daily', source, goal: 'g', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 86_400_000) },
  })
  if (paid) {
    await prisma.transaction.create({
      data: { ref: `TX${rid}${key}`, agentId: agentDbId, customerId: c.id, planId: plan.id, type: 'saving', amount: 100, status: 'Done', createdAt: paidAt },
    })
  }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: aid, phone: `0753${rid}`, name: 'A', location: 'L', password: 'x' } })
  agentDbId = a.id
  await mk('A', 'agent', false)
  await mk('B', 'agent', true)
  await mk('E', 'self', true)
})

after(async () => {
  M._load = realLoad
  await prisma.transaction.deleteMany({ where: { customerId: { in: custIds } } })
  await prisma.savingsPlan.deleteMany({ where: { customerId: { in: custIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: custIds } } })
  await prisma.agent.deleteMany({ where: { id: agentDbId } })
  await prisma.$disconnect()
})

test('rejects anonymous (401) and non-superadmin (403)', async () => {
  actAs(null)
  assert.equal((await call()).status, 401)
  actAs({ id: 'a1', role: 'agent' })
  assert.equal((await call()).status, 403)
})

test('every row has type + lastPaidAt, no photoUrl/password, carries gender/state/lga', async () => {
  actAs({ id: 'adm', role: 'superadmin' })
  const res = await call()
  assert.equal(res.status, 200)
  const { customers } = (await res.json()) as { customers: Row[] }
  assert.ok(customers.length >= 3)
  for (const r of customers) {
    assert.ok(r.type === 'offline' || r.type === 'online')
    assert.ok('lastPaidAt' in r)
    assert.ok(!('photoUrl' in r)); assert.ok(!('password' in r))
    assert.ok('gender' in r && 'state' in r && 'lga' in r)
  }
  const by = (k: string) => customers.find(r => r.id === ids[k])!
  assert.equal(by('A').type, 'offline'); assert.equal(by('A').lastPaidAt, null)
  assert.equal(by('B').type, 'offline'); assert.equal(by('B').lastPaidAt, paidAt.toISOString())
  assert.equal(by('E').type, 'online'); assert.equal(by('E').lastPaidAt, paidAt.toISOString())
  assert.equal(by('A').gender, 'Female'); assert.equal(by('A').state, 'Lagos'); assert.equal(by('A').lga, 'Ikeja')
})

test('type agrees with /api/customers for the same customers', async () => {
  actAs({ id: 'adm', role: 'superadmin' })
  const { customers } = (await (await call(`?search=${rid}`)).json()) as { customers: Row[] }
  stub.getServerSession = async () => ({ user: { agentId: aid } })
  const res = await agentGET({ url: `http://x/api/customers?limit=50` } as never)
  const agentRows = ((await res.json()) as { customers: Row[] }).customers
  assert.equal(agentRows.length, 3)
  for (const r of agentRows) assert.equal(customers.find(c => c.id === r.id)!.type, r.type)
})
