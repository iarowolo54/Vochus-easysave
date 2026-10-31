// Integration test: POST /api/loans enforces the tier's `enabled` and `maxAmount` (handoff #29).
// Real prisma; getServerSession stubbed via module hook. Rows use a per-run unique durationDays,
// deleted by id in teardown.
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
const { POST } = require('../src/app/api/loans/route') as typeof import('../src/app/api/loans/route')

const rid = Math.random().toString(36).slice(2, 8)
const DAY = 24 * 60 * 60 * 1000
const DAYS = 90000 + Math.floor(Math.random() * 9000) // unique tier duration for this run
let agentCode = ''
let agentDbId = ''
const customerIds: string[] = []
const planIds: string[] = []

const post = (body: unknown) => POST({ json: async () => body } as never)

async function mkCustomer(n: number, savings: number) {
  const c = await prisma.customer.create({
    data: { customerId: `LTE-${rid}-${n}`, agentId: agentDbId, firstName: 'C', lastName: 'X', phone: `08${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 180 * DAY), balance: savings, status: 'Active', source: 'agent' },
  })
  planIds.push(plan.id)
  return c
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `LTE-${rid}`, phone: `0796${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentDbId = a.id
  agentCode = a.agentId
  stub.getServerSession = async () => ({ user: { agentId: agentCode } })
})

after(async () => {
  M._load = realLoad
  await prisma.loan.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.auditLog.deleteMany({ where: { actorId: agentDbId } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.interestRate.deleteMany({ where: { durationDays: DAYS } })
  await prisma.agent.deleteMany({ where: { id: agentDbId } })
  await prisma.$disconnect()
})

test('tier enabled:false -> 400 "isn\'t offered", no loan created', async () => {
  await prisma.interestRate.upsert({
    where: { durationDays: DAYS },
    update: { rate: 5, maxAmount: null, enabled: false },
    create: { durationDays: DAYS, label: 'T', rate: 5, maxAmount: null, enabled: false },
  })
  const c = await mkCustomer(1, 10000) // maxLoan 8000, so 100 passes eligibility
  const res = await post({ customerId: c.id, principal: 100, durationDays: DAYS })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /isn.t offered/i)
  assert.equal(await prisma.loan.count({ where: { customerId: c.id } }), 0)
})

test('principal over maxAmount -> 400 "largest loan", no loan created', async () => {
  await prisma.interestRate.upsert({
    where: { durationDays: DAYS },
    update: { rate: 5, maxAmount: 1000, enabled: true },
    create: { durationDays: DAYS, label: 'T', rate: 5, maxAmount: 1000, enabled: true },
  })
  const c = await mkCustomer(2, 10000) // maxLoan 8000: principal 2000 passes eligibility but exceeds cap 1000
  const res = await post({ customerId: c.id, principal: 2000, durationDays: DAYS })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /largest loan/i)
  assert.equal(await prisma.loan.count({ where: { customerId: c.id } }), 0)
})

test('enabled tier, principal within cap and eligibility -> 201, loan created', async () => {
  await prisma.interestRate.upsert({
    where: { durationDays: DAYS },
    update: { rate: 5, maxAmount: 5000, enabled: true },
    create: { durationDays: DAYS, label: 'T', rate: 5, maxAmount: 5000, enabled: true },
  })
  const c = await mkCustomer(3, 10000)
  const res = await post({ customerId: c.id, principal: 2000, durationDays: DAYS })
  assert.equal(res.status, 201)
  assert.equal(await prisma.loan.count({ where: { customerId: c.id } }), 1)
})

test('principal exactly at maxAmount -> allowed (201)', async () => {
  await prisma.interestRate.upsert({
    where: { durationDays: DAYS },
    update: { rate: 5, maxAmount: 2000, enabled: true },
    create: { durationDays: DAYS, label: 'T', rate: 5, maxAmount: 2000, enabled: true },
  })
  const c = await mkCustomer(4, 10000)
  const res = await post({ customerId: c.id, principal: 2000, durationDays: DAYS })
  assert.equal(res.status, 201)
})
