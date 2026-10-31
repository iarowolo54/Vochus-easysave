// Verifies POST /api/transactions/saving/bulk: agents can bulk-pay MISSED (past) and FUTURE days
// for an OFFLINE plan (each contribution stamped with its chosen date); and that an ONLINE (self)
// plan ignores the chosen dates (stamped "now") — the backdate-safety rule.
import { test, before, after } from 'node:test'
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
const { POST } = require('../src/app/api/transactions/saving/bulk/route') as typeof import('../src/app/api/transactions/saving/bulk/route')

const rid = Math.random().toString(36).slice(2, 8)
const DAY = 86400000
let agentDbId = ''
const customerIds: string[] = []
const planIds: string[] = []
const ds = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * DAY)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const call = (body: unknown) => POST({ json: async () => body } as never)

async function mkCustomerPlan(n: number, source: string) {
  const c = await prisma.customer.create({
    data: { customerId: `SB-${rid}-${n}`, agentId: agentDbId, firstName: 'C', lastName: 'X', phone: `08${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: new Date(Date.now() - 60 * DAY), maturityDate: new Date(Date.now() + 120 * DAY), balance: 0, status: 'Active', source },
  })
  planIds.push(plan.id)
  return { c, plan }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `SB-${rid}`, phone: `0796${rid}`, name: 'A', location: 'x', password: 'x', walletBalance: 100000 } })
  agentDbId = a.id
  stub.getServerSession = async () => ({ user: { agentId: a.agentId } })
})

after(async () => {
  M._load = realLoad
  await prisma.transaction.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.auditLog.deleteMany({ where: { actorId: agentDbId } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: agentDbId } })
  await prisma.$disconnect()
})

test('OFFLINE: bulk pays a missed PAST day and a FUTURE day, each stamped with its chosen date', async () => {
  const { c, plan } = await mkCustomerPlan(1, 'agent')
  const past = ds(-10), future = ds(+10)
  const res = await call({ customerId: c.id, dates: [past, future], method: 'Cash', planId: plan.id })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.days, 2)
  assert.equal(body.total, 200)

  const txns = await prisma.transaction.findMany({ where: { planId: plan.id, type: 'saving' }, orderBy: { createdAt: 'asc' } })
  assert.equal(txns.length, 2)
  const stamped = txns.map(t => `${t.createdAt.getFullYear()}-${String(t.createdAt.getMonth() + 1).padStart(2, '0')}-${String(t.createdAt.getDate()).padStart(2, '0')}`).sort()
  assert.deepEqual(stamped, [past, future].sort(), 'both chosen dates (missed + future) are stamped')

  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 200, 'balance credited now')
  assert.equal((await prisma.agent.findUnique({ where: { id: agentDbId } }))?.walletBalance, 100000 - 200, 'agent wallet debited')
})

test('ONLINE (self): the chosen future date is IGNORED — contribution stamped now, not backdated/forward-dated', async () => {
  const { c, plan } = await mkCustomerPlan(2, 'self')
  const future = ds(+10)
  const res = await call({ customerId: c.id, dates: [future], method: 'Cash', planId: plan.id })
  assert.equal(res.status, 200)
  const t = await prisma.transaction.findFirst({ where: { planId: plan.id, type: 'saving' } })
  assert.ok(t)
  const stampedIso = `${t!.createdAt.getFullYear()}-${String(t!.createdAt.getMonth() + 1).padStart(2, '0')}-${String(t!.createdAt.getDate()).padStart(2, '0')}`
  assert.equal(stampedIso, ds(0), 'self plan stamps today, not the chosen future date')
  assert.notEqual(stampedIso, future)
})
