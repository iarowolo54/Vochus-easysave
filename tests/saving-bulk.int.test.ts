// Verifies POST /api/transactions/saving/bulk: agents can bulk-pay MISSED (past) and FUTURE days
// for an OFFLINE plan (each contribution stamped with its chosen date); and that ONLINE savers are refused:
// they pay by bank transfer only, never cash through an agent.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { prisma } from '../src/lib/prisma'
import { watKey } from '../src/lib/savings-card'

// Auto-debit charges in these tests must never reach Paystack: a test key makes chargeAuthorization answer
// 'success' locally (src/lib/paystack.ts isTestMode), whatever key the machine's environment holds.
process.env.PAYSTACK_SECRET_KEY = 'sk_test_saving_bulk'

const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => null }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const routeModule = require('../src/app/api/transactions/saving/bulk/route') as typeof import('../src/app/api/transactions/saving/bulk/route')

const { POST } = routeModule
const rid = Math.random().toString(36).slice(2, 8)
const redemptionIds: string[] = []
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
  await prisma.earlyRedemption.deleteMany({ where: { id: { in: redemptionIds } } })
  await prisma.autoDebitAttempt.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.autoDebitMandate.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.planDayCoverage.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.paymentIntent.deleteMany({ where: { planId: { in: planIds } } })
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

test('ONLINE: an agent cannot record cash for an online plan or an online customer, and nothing is written', async () => {
  const self = await mkCustomerPlan(2, 'self')
  const res = await call({ customerId: self.c.id, dates: [ds(1)], method: 'Cash', planId: self.plan.id })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /bank transfer only/)

  const typed = await mkCustomerPlan(3, 'agent')
  await prisma.customer.update({ where: { id: typed.c.id }, data: { type: 'online' } })
  assert.equal((await call({ customerId: typed.c.id, dates: [ds(1)], method: 'Cash', planId: typed.plan.id })).status, 400)

  assert.equal(await prisma.transaction.count({ where: { planId: { in: [self.plan.id, typed.plan.id] } } }), 0)
  assert.equal((await prisma.agent.findUniqueOrThrow({ where: { id: agentDbId } })).walletBalance, 100000 - 200, 'wallet untouched since the offline test')
})

// ── Online plans: the same rules as the customer's own Bulk Savings ──
const wallet = async () => (await prisma.agent.findUniqueOrThrow({ where: { id: agentDbId } })).walletBalance
const setWallet = (walletBalance: number) => prisma.agent.update({ where: { id: agentDbId }, data: { walletBalance } })
let seq = 100

async function online(cadence = 'daily') {
  const { c, plan } = await mkCustomerPlan(++seq, 'self')
  await prisma.savingsPlan.update({ where: { id: plan.id }, data: { cadence, startDate: new Date(Date.now() - 10 * DAY), periodDays: 180 } })
  await setWallet(100000)
  return { c, plan: await prisma.savingsPlan.findUniqueOrThrow({ where: { id: plan.id } }) }
}

test('OFFLINE is unchanged: per date, stamped with the date, no coverage, even weekly and monthly', async () => {
  for (const cadence of ['daily', 'weekly', 'monthly']) {
    const { c, plan } = await mkCustomerPlan(++seq, 'agent')
    await prisma.savingsPlan.update({ where: { id: plan.id }, data: { cadence } })
    await setWallet(1000)
    const past = ds(-10), future = ds(+10)
    const res = await call({ customerId: c.id, dates: [past, future], method: 'Cash', planId: plan.id })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).total, 200)
    assert.equal(await wallet(), 800)
    const stamped = (await prisma.transaction.findMany({ where: { planId: plan.id } })).map(t => t.createdAt.getTime()).sort()
    assert.deepEqual(stamped, [past, future].map(d => new Date(d + 'T12:00:00').getTime()).sort())
    assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), 0)
  }
})

test('OFFLINE is unchanged: a held key or open redemption does not block an agent cash plan here', async () => {
  const { c, plan } = await mkCustomerPlan(++seq, 'agent')
  await setWallet(1000)
  await prisma.paymentIntent.create({ data: { ref: `hold-off-${rid}-${plan.id}`, actorType: 'customer', customerId: c.id, planId: plan.id, amount: 100, coversKeys: JSON.stringify([ds(1)]) } })
  assert.equal((await call({ customerId: c.id, dates: [ds(1)], method: 'Cash', planId: plan.id })).status, 200)
})

test('GET: only the customer\'s own agent sees the calendar; online plans get slots and the slot price', async () => {
  const { GET } = routeModule
  const get = (planId: string) => GET({ nextUrl: new URL(`http://x/?planId=${planId}`) } as never)
  const w = await online('weekly')
  const body = await (await get(w.plan.id)).json()
  assert.equal(body.online, true)
  assert.equal(body.weekly, true)
  assert.equal(body.perSlot, 700)
  assert.equal(body.slots[0].key, watKey(w.plan.startDate))
  const off = await mkCustomerPlan(++seq, 'agent')
  assert.deepEqual(await (await get(off.plan.id)).json(), { online: false })

  const other = await prisma.agent.create({ data: { agentId: `SB-O-${rid}`, phone: `0790${rid}`, name: 'B', location: 'x', password: 'x' } })
  const before = stub.getServerSession
  stub.getServerSession = async () => ({ user: { agentId: other.agentId } })
  try {
    assert.equal((await get(w.plan.id)).status, 404)
  } finally {
    stub.getServerSession = before
    await prisma.agent.deleteMany({ where: { id: other.id } })
  }
})

test('after the photo deadline a customer with no photo is paused (403 PHOTO_REQUIRED); adding the photo unblocks the very next call', async () => {
  const { c, plan } = await mkCustomerPlan(90, 'agent')
  await prisma.platformSetting.upsert({ where: { key: 'photoDeadline' }, update: { value: new Date(Date.now() - 3600e3).toISOString() }, create: { key: 'photoDeadline', value: new Date(Date.now() - 3600e3).toISOString() } })
  try {
    const blocked = await call({ customerId: c.id, dates: [ds(-1)], method: 'Cash', planId: plan.id })
    assert.equal(blocked.status, 403)
    const body = await blocked.json()
    assert.equal(body.code, 'PHOTO_REQUIRED')
    assert.equal(await prisma.transaction.count({ where: { planId: plan.id } }), 0, 'nothing written while paused')

    await prisma.customer.update({ where: { id: c.id }, data: { photoUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==' } })
    const ok = await call({ customerId: c.id, dates: [ds(-1)], method: 'Cash', planId: plan.id })
    assert.equal(ok.status, 200)
  } finally {
    await prisma.platformSetting.deleteMany({ where: { key: 'photoDeadline' } })
  }
})
