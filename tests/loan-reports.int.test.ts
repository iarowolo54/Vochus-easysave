// Admin loan reports: repayments day window (Africa/Lagos) + disbursements' real disbursed date.
// getServerSession is stubbed like savings-interest-admin.int.test.ts. Rows are tagged by run id
// (loan ref / agentId) and deleted by id; the shared tables are never wiped.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { prisma } from '../src/lib/prisma'

const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => ({ user: { id: 'x', name: 'Test Admin', role: 'superadmin' } }) }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const repayRoute = require('../src/app/api/admin/loan-repayments/route') as typeof import('../src/app/api/admin/loan-repayments/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const disburseRoute = require('../src/app/api/admin/loan-disbursements/route') as typeof import('../src/app/api/admin/loan-disbursements/route')

const RUN = `lr${Math.random().toString(36).slice(2, 10)}`
const ids = { agent: '', customer: '', loanA: '', loanB: '', audit: '' }

type RepBody = { repayments: { id: string; amount: number }[]; todayCount: number; todayAmount: number; totalRepayments: number }
type DisBody = { loans: { ref: string; createdAt: string; disbursedAt: string | null }[] }

const getRepayments = async (qs: string) =>
  (await (await repayRoute.GET(new Request(`http://t/api/admin/loan-repayments?${qs}`) as never)).json()) as RepBody

before(async () => {
  const agent = await prisma.agent.create({ data: { agentId: `AG-${RUN}`, phone: `p${RUN}`, name: 'T', location: 'L', password: 'x' } })
  ids.agent = agent.id
  const customer = await prisma.customer.create({
    data: { customerId: `C-${RUN}`, agentId: agent.id, firstName: 'T', lastName: 'C', phone: `c${RUN}`, address: 'a', nokName: 'n', nokRelation: 'r', nokPhone: '1' },
  })
  ids.customer = customer.id
  const mk = (ref: string, createdAt: Date, status: string) =>
    prisma.loan.create({
      data: { ref, agentId: agent.id, customerId: customer.id, principal: 1000, interestRate: 10, interestAmount: 100, totalAmount: 1100, durationDays: 30, dueDate: new Date('2031-01-01'), status, createdAt },
    })
  ids.loanA = (await mk(`LN-${RUN}-A`, new Date('2030-01-01T10:00:00Z'), 'Disbursed')).id
  ids.loanB = (await mk(`LN-${RUN}-B`, new Date('2030-01-02T10:00:00Z'), 'Disbursed')).id // no audit row -> null
  const a = await prisma.auditLog.create({
    data: { action: 'loan_disburse', entity: 'Loan', entityId: ids.loanA, actorId: agent.id, createdAt: new Date('2030-01-05T09:00:00Z') },
  })
  ids.audit = a.id
})

after(async () => {
  M._load = realLoad
  await prisma.loanRepayment.deleteMany({ where: { loanId: { in: [ids.loanA, ids.loanB] } } })
  await prisma.auditLog.deleteMany({ where: { id: ids.audit } })
  await prisma.loan.deleteMany({ where: { id: { in: [ids.loanA, ids.loanB] } } })
  await prisma.customer.deleteMany({ where: { id: ids.customer } })
  await prisma.agent.deleteMany({ where: { id: ids.agent } })
  await prisma.$disconnect()
})

test('repayments date filter uses the Africa/Lagos day, not UTC midnight', async () => {
  // 22:30Z on the 10th = 23:30 Lagos on the 10th; 23:30Z on the 10th = 00:30 Lagos on the 11th.
  const early = await prisma.loanRepayment.create({ data: { loanId: ids.loanA, amount: 10, createdAt: new Date('2030-01-10T22:30:00Z') } })
  const late = await prisma.loanRepayment.create({ data: { loanId: ids.loanA, amount: 20, createdAt: new Date('2030-01-10T23:30:00Z') } })
  const day10 = (await getRepayments(`search=${RUN}&date=2030-01-10`)).repayments.map(r => r.id)
  const day11 = (await getRepayments(`search=${RUN}&date=2030-01-11`)).repayments.map(r => r.id)
  assert.deepEqual(day10, [early.id])
  assert.deepEqual(day11, [late.id])
})

test('repayments window is half-open: Lagos midnight belongs to the new day', async () => {
  const edge = await prisma.loanRepayment.create({ data: { loanId: ids.loanA, amount: 5, createdAt: new Date('2030-02-09T23:00:00Z') } }) // 00:00 Lagos 10 Feb
  assert.deepEqual((await getRepayments(`search=${RUN}&date=2030-02-10`)).repayments.map(r => r.id), [edge.id])
  assert.deepEqual((await getRepayments(`search=${RUN}&date=2030-02-09`)).repayments.map(r => r.id), [])
})

test('today totals are aggregated and move by the amount of a new repayment', async () => {
  const before = await getRepayments('')
  await prisma.loanRepayment.create({ data: { loanId: ids.loanA, amount: 123 } })
  const after = await getRepayments('')
  assert.equal(after.todayCount - before.todayCount, 1)
  assert.equal(after.todayAmount - before.todayAmount, 123)
  assert.equal(after.totalRepayments - before.totalRepayments, 1)
})

test('disbursements carry the real disbursed date, distinct from the request date', async () => {
  const body = (await (await disburseRoute.GET(new Request('http://t/api/admin/loan-disbursements') as never)).json()) as DisBody
  const a = body.loans.find(l => l.ref === `LN-${RUN}-A`)
  const b = body.loans.find(l => l.ref === `LN-${RUN}-B`)
  assert.ok(a && b)
  assert.equal(new Date(a.createdAt).toISOString(), '2030-01-01T10:00:00.000Z')
  assert.equal(new Date(a.disbursedAt as string).toISOString(), '2030-01-05T09:00:00.000Z')
  assert.equal(b.disbursedAt, null) // no recorded disbursement -> unknown, not the request date
})
