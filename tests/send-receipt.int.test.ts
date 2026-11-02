// POST /api/transactions/send-receipt. Session is stubbed like admin-agent-detail.int.test.ts.
// Rows are scoped by a unique run id and deleted by id only.
process.env.NEXTAUTH_SECRET ??= 'test-secret'
import { test, before, after, beforeEach } from 'node:test'
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
const { POST } = require('../src/app/api/transactions/send-receipt/route') as typeof import('../src/app/api/transactions/send-receipt/route')

const RUN = Math.random().toString(36).slice(2, 10)
const ids = { agent: '', other: '', custA: '', custB: '', moved: '', plan: '', planB: '' }
const tx: Record<string, string> = {}

const call = (body: unknown) => POST({ json: async () => body } as never)
const actAs = (agentId: string | null) => { stub.getServerSession = async () => (agentId ? { user: { agentId } } : null) }
const asOwner = () => actAs(`SR-${RUN}`)
const messages = (customerId: string) => prisma.customerChatMessage.findMany({ where: { customerId } })
const mkCustomer = (sfx: string, agentId: string) => prisma.customer.create({ data: {
  customerId: `SR${sfx}-${RUN}`, agentId, firstName: 'ada', lastName: `obi${sfx}`, phone: `08${sfx}${RUN}`,
  address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800',
} })

before(async () => {
  const agent = await prisma.agent.create({ data: { agentId: `SR-${RUN}`, phone: `070${RUN}`, name: 'Bola Agent', location: 'x', password: 'x', walletBalance: 777 } })
  const other = await prisma.agent.create({ data: { agentId: `SO-${RUN}`, phone: `071${RUN}`, name: 'Other', location: 'x', password: 'x' } })
  ids.agent = agent.id; ids.other = other.id
  ids.custA = (await mkCustomer('1', agent.id)).id
  ids.custB = (await mkCustomer('2', agent.id)).id
  ids.moved = (await mkCustomer('3', other.id)).id
  const mkPlan = async (customerId: string, goal: string) => (await prisma.savingsPlan.create({ data: {
    customerId, dailyAmount: 100, periodDays: 30, goal, startDate: new Date(), maturityDate: new Date(), balance: 555,
  } })).id
  ids.plan = await mkPlan(ids.custA, 'School fees')
  ids.planB = await mkPlan(ids.custA, 'Rent')
  const mk = async (key: string, data: { agentId?: string; customerId?: string | null; planId?: string; type?: string; amount?: number; status?: string; createdAt?: Date }) => {
    const t = await prisma.transaction.create({ data: {
      ref: `SR-${key}-${RUN}`, agentId: ids.agent, customerId: ids.custA, planId: ids.plan, type: 'saving', amount: 100, ...data,
    } })
    tx[key] = t.id
  }
  await mk('one', { amount: 1250 })
  await mk('d1', { createdAt: new Date('2026-03-01T11:00:00.000Z') })
  await mk('d2', { createdAt: new Date('2026-03-02T11:00:00.000Z') })
  await mk('d3', { createdAt: new Date('2026-03-03T11:00:00.000Z') })
  await mk('enrol', { type: 'enrolment', amount: 500 })
  await mk('pending', { status: 'Pending' })
  await mk('otherPlan', { planId: ids.planB })
  await mk('custB', { customerId: ids.custB, planId: undefined })
  await mk('noCustomer', { customerId: null, type: 'wallet_funding' })
  await mk('foreign', { agentId: ids.other })
  await mk('moved', { customerId: ids.moved })
})

beforeEach(async () => {
  asOwner()
  await prisma.customerChatMessage.deleteMany({ where: { customerId: { in: [ids.custA, ids.custB, ids.moved] } } })
})

after(async () => {
  await prisma.customerChatMessage.deleteMany({ where: { customerId: { in: [ids.custA, ids.custB, ids.moved] } } })
  await prisma.transaction.deleteMany({ where: { id: { in: Object.values(tx) } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: [ids.plan, ids.planB] } } })
  await prisma.customer.deleteMany({ where: { id: { in: [ids.custA, ids.custB, ids.moved] } } })
  await prisma.agent.deleteMany({ where: { id: { in: [ids.agent, ids.other] } } })
  await prisma.$disconnect()
})

test('401 with no session, before reading the body', async () => {
  actAs(null)
  const res = await POST({ json: async () => { throw new Error('body read') } } as never)
  assert.equal(res.status, 401)
})

test('400 for a bad body, and nothing is sent', async () => {
  const tooMany = Array.from({ length: 91 }, (_, i) => `id-${i}`)
  for (const body of [null, {}, { ids: 'x' }, { ids: [] }, { ids: [1] }, { ids: [''] }, { ids: [tx.one, tx.one] }, { ids: tooMany }]) {
    assert.equal((await call(body)).status, 400, JSON.stringify(body))
  }
  const bad = await POST({ json: async () => { throw new SyntaxError('bad json') } } as never)
  assert.equal(bad.status, 400)
  assert.equal((await messages(ids.custA)).length, 0)
})

test('one id posts a normal receipt as the agent, with no image', async () => {
  const res = await call({ ids: [tx.one] })
  assert.equal(res.status, 200)
  const [m, ...rest] = await messages(ids.custA)
  assert.equal(rest.length, 0)
  assert.equal(m.sender, 'agent')
  assert.equal(m.senderId, ids.agent)
  assert.equal(m.senderName, 'Bola Agent')
  assert.equal(m.imageUrl, null)
  assert.match(m.message, /Amount: ₦1,250\.00/)
  assert.match(m.message, new RegExp(`Reference: SR-one-${RUN}$`))
})

test('content and customer come from the database, never the request', async () => {
  const res = await call({ ids: [tx.one], text: 'FORGED', message: 'FORGED', amount: 999999, customerId: ids.custB })
  assert.equal(res.status, 200)
  const [m] = await messages(ids.custA)
  assert.doesNotMatch(m.message, /FORGED|999,999/)
  assert.equal((await messages(ids.custB)).length, 0)
})

test('several ids post one message, with the first reference in request order', async () => {
  const res = await call({ ids: [tx.d2, tx.d1, tx.d3] })
  assert.equal(res.status, 200)
  const msgs = await messages(ids.custA)
  assert.equal(msgs.length, 1)
  assert.match(msgs[0].message, /Total: ₦300\.00/)
  assert.match(msgs[0].message, /Paid for: 3 days between 1 Mar 2026 and 3 Mar 2026/)
  assert.match(msgs[0].message, new RegExp(`Reference: SR-d2-${RUN} \\+2 more`))
})

test('enrolment receipt has no amount', async () => {
  assert.equal((await call({ ids: [tx.enrol] })).status, 200)
  const [m] = await messages(ids.custA)
  assert.doesNotMatch(m.message, /₦/)
})

test('404 if any transaction is missing or another agent\'s, and nothing is sent', async () => {
  assert.equal((await call({ ids: [tx.one, 'nope'] })).status, 404)
  assert.equal((await call({ ids: [tx.one, tx.foreign] })).status, 404)
  assert.equal((await messages(ids.custA)).length, 0)
})

test('404 when the customer now belongs to another agent', async () => {
  assert.equal((await call({ ids: [tx.moved] })).status, 404)
  assert.equal((await messages(ids.moved)).length, 0)
})

test('400 for mixed customers or no customer', async () => {
  assert.equal((await call({ ids: [tx.one, tx.custB] })).status, 400)
  assert.equal((await call({ ids: [tx.noCustomer] })).status, 400)
  assert.equal((await messages(ids.custA)).length, 0)
  assert.equal((await messages(ids.custB)).length, 0)
})

test('400 when several ids are not one savings payment', async () => {
  for (const other of [tx.enrol, tx.pending, tx.otherPlan]) {
    assert.equal((await call({ ids: [tx.d1, other] })).status, 400)
  }
  assert.equal((await messages(ids.custA)).length, 0)
})

test('sending changes no balances', async () => {
  await call({ ids: [tx.one] })
  const agent = await prisma.agent.findUniqueOrThrow({ where: { id: ids.agent } })
  const plan = await prisma.savingsPlan.findUniqueOrThrow({ where: { id: ids.plan } })
  assert.equal(agent.walletBalance, 777)
  assert.equal(plan.balance, 555)
})
