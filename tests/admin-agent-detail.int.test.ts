// Admin agent-detail API must not leak secrets. Session is stubbed like savings-interest-admin.int.test.ts.
// Rows are scoped by a unique run id and deleted by id only.
import { test, after, before } from 'node:test'
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
const { GET } = require('../src/app/api/admin/agents/[id]/detail/route') as typeof import('../src/app/api/admin/agents/[id]/detail/route')

const RUN = Math.random().toString(36).slice(2, 10)
const S = {
  agentPw: `AGPW-${RUN}-hash`, agentPin: `AGPIN-${RUN}-hash`, agentPhoto: `data:image/png;base64,AGPHOTO${RUN}`,
  agentDevice: `AGDEV-${RUN}`, agentBvn: `AGBVN${RUN}`, agentNin: `AGNIN${RUN}`, agentToken: `AGTOK-${RUN}`,
  custPw: `CUPW-${RUN}-hash`, custPhoto: `data:image/png;base64,CUPHOTO${RUN}`, custDevice: `CUDEV-${RUN}`,
  custBvn: `CUBVN${RUN}`, custInvite: `CUINV-${RUN}`,
}
const ids = { agent: '', customer: '', plan: '', ptx: '', loan: '', rep: '' }
const call = () => GET({} as never, { params: Promise.resolve({ id: ids.agent }) })
const actAs = (u: { id: string; role?: string } | null) => { stub.getServerSession = async () => (u ? { user: { name: 'T', ...u } } : null) }

before(async () => {
  const agent = await prisma.agent.create({ data: {
    agentId: `AG-${RUN}`, phone: `080${RUN}`, name: `Agent ${RUN}`, location: 'Lagos', password: S.agentPw,
    transactionPin: S.agentPin, photoUrl: S.agentPhoto, boundDeviceId: S.agentDevice, bvn: S.agentBvn, nin: S.agentNin,
    unlockToken: S.agentToken, bankName: 'TestBank', accountNumber: '0123456789', accountName: `Acc ${RUN}`,
  } })
  ids.agent = agent.id
  const cust = await prisma.customer.create({ data: {
    customerId: `CU-${RUN}`, agentId: agent.id, firstName: `First${RUN}`, lastName: 'Last', phone: `081${RUN}`, address: 'Addr',
    nokName: 'N', nokRelation: 'R', nokPhone: '1', password: S.custPw, photoUrl: S.custPhoto, boundDeviceId: S.custDevice,
    bvn: S.custBvn, inviteToken: S.custInvite,
  } })
  ids.customer = cust.id
  const plan = await prisma.savingsPlan.create({ data: {
    customerId: cust.id, dailyAmount: 100, periodDays: 30, goal: `Goal ${RUN}`, startDate: new Date(), maturityDate: new Date(),
  } })
  ids.plan = plan.id
  const ptx = await prisma.transaction.create({ data: {
    ref: `TX-${RUN}`, agentId: agent.id, customerId: cust.id, planId: plan.id, type: 'saving', amount: 100,
  } })
  ids.ptx = ptx.id
  const loan = await prisma.loan.create({ data: {
    ref: `LN-${RUN}`, agentId: agent.id, customerId: cust.id, principal: 1000, interestRate: 10, interestAmount: 100,
    totalAmount: 1100, durationDays: 30, dueDate: new Date(),
  } })
  ids.loan = loan.id
  ids.rep = (await prisma.loanRepayment.create({ data: { loanId: loan.id, amount: 50 } })).id
})

after(async () => {
  M._load = realLoad
  if (ids.rep) await prisma.loanRepayment.delete({ where: { id: ids.rep } }).catch(() => {})
  if (ids.loan) await prisma.loan.delete({ where: { id: ids.loan } }).catch(() => {})
  if (ids.ptx) await prisma.transaction.delete({ where: { id: ids.ptx } }).catch(() => {})
  if (ids.plan) await prisma.savingsPlan.delete({ where: { id: ids.plan } }).catch(() => {})
  if (ids.customer) await prisma.customer.delete({ where: { id: ids.customer } }).catch(() => {})
  if (ids.agent) await prisma.agent.delete({ where: { id: ids.agent } }).catch(() => {})
  await prisma.$disconnect()
})

test('requires superadmin', async () => {
  actAs(null); assert.equal((await call()).status, 401)
  actAs({ id: 'x', role: 'agent' }); assert.equal((await call()).status, 403)
})

test('unknown agent -> 404', async () => {
  actAs({ id: 'a', role: 'superadmin' })
  const res = await GET({} as never, { params: Promise.resolve({ id: `missing-${RUN}` }) })
  assert.equal(res.status, 404)
})

test('response leaks no secrets and no base64 photos', async () => {
  actAs({ id: 'a', role: 'superadmin' })
  const res = await call()
  assert.equal(res.status, 200)
  const text = JSON.stringify(await res.json())
  for (const [k, v] of Object.entries(S)) assert.ok(!text.includes(v), `leaked ${k}`)
  for (const key of ['"password"', '"transactionPin"', '"boundDeviceId"', '"photoUrl"', '"fileData"', '"inviteToken"', '"bvn"', '"nin"', '"unlockToken"']) {
    assert.ok(!text.includes(key), `response has key ${key}`)
  }
})

test('response still carries the fields the page renders', async () => {
  actAs({ id: 'a', role: 'superadmin' })
  const { agent } = (await (await call()).json()) as { agent: Record<string, any> }
  assert.equal(agent.name, `Agent ${RUN}`)
  assert.equal(agent.agentId, `AG-${RUN}`)
  assert.equal(agent.deviceBound, true)
  assert.equal(agent.accountName, `Acc ${RUN}`)
  assert.equal(agent.customers.length, 1)
  const c = agent.customers[0]
  assert.equal(c.firstName, `First${RUN}`)
  assert.equal(c.savingsPlans[0].goal, `Goal ${RUN}`)
  assert.equal(c.savingsPlans[0].transactions[0].ref, `TX-${RUN}`)
  assert.equal(c.loans[0].ref, `LN-${RUN}`)
  assert.equal(c.loans[0].repayments[0].amount, 50)
  assert.equal(agent.transactions[0].ref, `TX-${RUN}`)
  assert.ok(Array.isArray(agent.memberCards))
})
