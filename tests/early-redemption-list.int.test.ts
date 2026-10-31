// GET /api/admin/early-redemption: pending counts every awaiting-action status (incl. AwaitingOTP,
// Finalizing) and each record carries isEarly = now < plan.maturityDate. The table is shared, so
// assertions use deltas and run-id'd rows only.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { prisma } from '../src/lib/prisma'

const rid = Math.random().toString(36).slice(2, 10)
const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => null }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('../src/app/api/admin/early-redemption/route') as typeof import('../src/app/api/admin/early-redemption/route')

type Body = { pending: number; records: { ref: string; isEarly: boolean }[] }
const get = async () => (await GET()).json() as Promise<Body>

let agentDbId = ''
let custId = ''
const planIds: string[] = []
const day = 86_400_000

async function mkPlan(maturityDate: Date) {
  const p = await prisma.savingsPlan.create({
    data: { customerId: custId, dailyAmount: 100, periodDays: 30, cadence: 'daily', source: 'agent', goal: 'g', startDate: new Date(Date.now() - 60 * day), maturityDate },
  })
  planIds.push(p.id)
  return p.id
}
const mkRed = (savingsPlanId: string, key: string, status: string) =>
  prisma.earlyRedemption.create({ data: { ref: `ERT-${rid}-${key}`, savingsPlanId, reason: 'r', status, balance: 100, netPayout: 90 } })

let before0 = 0
before(async () => {
  stub.getServerSession = async () => ({ user: { name: 'T', id: `adm-${rid}`, role: 'superadmin' } })
  before0 = (await get()).pending
  const a = await prisma.agent.create({ data: { agentId: `ER-${rid}`, phone: `0754${rid}`, name: 'A', location: 'L', password: 'x' } })
  agentDbId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `ER${rid}`, agentId: a.id, firstName: 'F', lastName: 'L', phone: `09${rid}`, address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0' },
  })
  custId = c.id
})

after(async () => {
  M._load = realLoad
  await prisma.earlyRedemption.deleteMany({ where: { ref: { startsWith: `ERT-${rid}` } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: custId } })
  await prisma.agent.deleteMany({ where: { id: agentDbId } })
  await prisma.$disconnect()
})

test('pending counts AwaitingOTP and Finalizing, not Approved', async () => {
  const plan = await mkPlan(new Date(Date.now() + 10 * day))
  await mkRed(plan, 'otp', 'AwaitingOTP')
  await mkRed(plan, 'fin', 'Finalizing')
  await mkRed(plan, 'pen', 'Pending')
  await mkRed(plan, 'app', 'Approved')
  assert.equal((await get()).pending - before0, 3)
})

test('isEarly reflects maturityDate', async () => {
  const past = await mkPlan(new Date(Date.now() - 5 * day))
  const future = await mkPlan(new Date(Date.now() + 5 * day))
  await mkRed(past, 'past', 'Pending')
  await mkRed(future, 'fut', 'Pending')
  const { records } = await get()
  assert.equal(records.find(r => r.ref === `ERT-${rid}-past`)?.isEarly, false)
  assert.equal(records.find(r => r.ref === `ERT-${rid}-fut`)?.isEarly, true)
})
