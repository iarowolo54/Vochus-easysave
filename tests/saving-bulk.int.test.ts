// Verifies POST /api/transactions/saving/bulk: agents can bulk-pay MISSED (past) and FUTURE days
// for an OFFLINE plan (each contribution stamped with its chosen date); and that an ONLINE (self)
// plan ignores the chosen dates (stamped "now") — the backdate-safety rule.
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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runDueAutoDebits } = require('../src/lib/auto-debit-run') as typeof import('../src/lib/auto-debit-run')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { liveSlots } = require('../src/lib/bulk-savings') as typeof import('../src/lib/bulk-savings')
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

// ── Online plans: the same rules as the customer's own Bulk Savings ──
const wat = (offsetDays: number) => watKey(new Date(Date.now() + offsetDays * DAY))
const wallet = async () => (await prisma.agent.findUniqueOrThrow({ where: { id: agentDbId } })).walletBalance
const setWallet = (walletBalance: number) => prisma.agent.update({ where: { id: agentDbId }, data: { walletBalance } })
let seq = 100

async function online(cadence = 'daily') {
  const { c, plan } = await mkCustomerPlan(++seq, 'self')
  await prisma.savingsPlan.update({ where: { id: plan.id }, data: { cadence, startDate: new Date(Date.now() - 10 * DAY), periodDays: 180 } })
  await setWallet(100000)
  return { c, plan: await prisma.savingsPlan.findUniqueOrThrow({ where: { id: plan.id } }) }
}

test('ONLINE daily: writes coverage tagged with each ref, debits the wallet by exactly the total', async () => {
  const { c, plan } = await online()
  const keys = [wat(1), wat(2)]
  const res = await call({ customerId: c.id, dates: keys, method: 'Cash', planId: plan.id })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.total, 200)
  assert.equal(await wallet(), 100000 - 200)
  assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: plan.id } })).balance, 200)
  const txs = await prisma.transaction.findMany({ where: { planId: plan.id }, orderBy: { walletAfter: 'desc' } })
  const cov = await prisma.planDayCoverage.findMany({ where: { savingsPlanId: plan.id } })
  assert.deepEqual(cov.map(x => x.coversKey).sort(), [...keys].sort())
  assert.deepEqual(cov.map(x => x.ref).sort(), txs.map(t => t.ref).sort())
  assert.ok(txs.every(t => Date.now() - t.createdAt.getTime() < 60_000), 'stamped now')
})

test('ONLINE: those deposits are coverage payments, not saved today, and auto-debit skips the days they bought', async () => {
  const { c, plan } = await online()
  const res = await call({ customerId: c.id, dates: [wat(1)], method: 'Cash', planId: plan.id })
  assert.equal(res.status, 200)
  const slots = await liveSlots(prisma, plan, new Date())
  assert.equal(slots.find(s => s.key === wat(0))?.state, 'today')
  assert.equal(slots.find(s => s.key === wat(1))?.state, 'saved')

  const m = await prisma.autoDebitMandate.create({
    data: { customerId: c.id, savingsPlanId: plan.id, authorizationCode: `AUTH_${rid}`, authSignature: 'sig', authEmail: 'a@b.c', status: 'active', amountPerCycle: 100, nextRunAt: new Date(Date.now() - 1000) },
  })
  const scope = { mandateIds: [m.id] }
  assert.deepEqual(await runDueAutoDebits(prisma, new Date(), scope), { charged: 1, skipped: 0, failed: 0, pending: 0 })
  assert.deepEqual(await runDueAutoDebits(prisma, new Date(Date.now() + DAY), scope), { charged: 0, skipped: 1, failed: 0, pending: 0 })
})

test('ONLINE weekly: one week costs 7x, keyed by the week slot, and the wallet pays exactly that', async () => {
  const { c, plan } = await online('weekly')
  const nextWeek = watKey(new Date(plan.startDate.getTime() + 14 * DAY))
  const res = await call({ customerId: c.id, dates: [nextWeek], method: 'Cash', planId: plan.id })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).total, 700)
  assert.equal(await wallet(), 100000 - 700)
  assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: plan.id } })).balance, 700)
  assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: plan.id, coversKey: nextWeek } }), 1)
})

test('ONLINE weekly: a date that is not the start of a week slot is refused', async () => {
  const { c, plan } = await online('weekly')
  const midWeek = watKey(new Date(plan.startDate.getTime() + 16 * DAY))
  assert.equal((await call({ customerId: c.id, dates: [midWeek], method: 'Cash', planId: plan.id })).status, 400)
  assert.equal(await wallet(), 100000)
})

test('ONLINE: an insufficient wallet writes nothing', async () => {
  const { c, plan } = await online()
  await setWallet(50)
  assert.equal((await call({ customerId: c.id, dates: [wat(1)], method: 'Cash', planId: plan.id })).status, 400)
  assert.equal(await wallet(), 50)
  assert.equal(await prisma.planDayCoverage.count({ where: { savingsPlanId: plan.id } }), 0)
  assert.equal(await prisma.transaction.count({ where: { planId: plan.id } }), 0)
})

for (const [label, prepare, expected] of [
  ['an already-covered day', async (planId: string) => { await prisma.planDayCoverage.create({ data: { savingsPlanId: planId, coversKey: wat(1), ref: `pre-${rid}-${planId}` } }) }, 400],
  ['an open redemption', async (planId: string) => { const r = await prisma.earlyRedemption.create({ data: { ref: `er-${rid}-${planId}`, savingsPlanId: planId, balance: 0, status: 'Pending', reason: 'x', netPayout: 0 } }); redemptionIds.push(r.id) }, 409],
  ['a fresh checkout on the day', async (planId: string, customerId: string) => { await prisma.paymentIntent.create({ data: { ref: `hold-${rid}-${planId}`, actorType: 'customer', customerId, planId, amount: 100, coversKeys: JSON.stringify([wat(1)]) } }) }, 409],
] as const) {
  test(`ONLINE: ${label} is refused with ${expected}, and the wallet is untouched`, async () => {
    const { c, plan } = await online()
    await prepare(plan.id, c.id)
    assert.equal((await call({ customerId: c.id, dates: [wat(1)], method: 'Cash', planId: plan.id })).status, expected)
    assert.equal(await wallet(), 100000)
    assert.equal(await prisma.transaction.count({ where: { planId: plan.id } }), 0)
  })
}

test('ONLINE: an agent refused by a customer checkout is told why, with a readable date', async () => {
  const { c, plan } = await online()
  await prisma.paymentIntent.create({ data: { ref: `hold-msg-${rid}-${plan.id}`, actorType: 'customer', customerId: c.id, planId: plan.id, amount: 100, coversKeys: JSON.stringify([wat(1)]) } })
  const res = await call({ customerId: c.id, dates: [wat(1)], method: 'Cash', planId: plan.id })
  assert.equal(res.status, 409)
  const { error } = await res.json()
  assert.match(error, /customer has a card payment open/i)
  assert.doesNotMatch(error, /\d{4}-\d{2}-\d{2}/)
})

test('ONLINE monthly is refused', async () => {
  const { c, plan } = await online('monthly')
  assert.equal((await call({ customerId: c.id, dates: [wat(1)], method: 'Cash', planId: plan.id })).status, 400)
  assert.equal(await wallet(), 100000)
})

test('ONLINE: a past-maturity plan and a non-string date are refused', async () => {
  const a = await online()
  await prisma.savingsPlan.update({ where: { id: a.plan.id }, data: { maturityDate: new Date(Date.now() - 1000) } })
  // An ended plan is 409 PLAN_ENDED since 167f54c (ended plans can't be saved into).
  assert.equal((await call({ customerId: a.c.id, dates: [wat(-1)], method: 'Cash', planId: a.plan.id })).status, 409)
  const b = await online()
  assert.equal((await call({ customerId: b.c.id, dates: [12345], method: 'Cash', planId: b.plan.id })).status, 400)
})

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

test('ONLINE: a charge starting between the check and the credit refuses it, with the wallet untouched', async () => {
  const { c, plan } = await online()
  const m = await prisma.autoDebitMandate.create({
    data: { customerId: c.id, savingsPlanId: plan.id, authorizationCode: `AUTH_${rid}`, authSignature: 'sig', authEmail: 'a@b.c', status: 'active', amountPerCycle: 100, nextRunAt: new Date() },
  })
  await prisma.autoDebitAttempt.create({
    data: { mandateId: m.id, savingsPlanId: plan.id, reference: `autodebit-${plan.id}-race`, cycleDate: new Date(Date.now() + DAY), creditAmount: 100, grossCharged: 102, feeEstimate: 2, status: 'processing' },
  })
  const delegate = prisma.autoDebitAttempt as unknown as { findMany: (a: unknown) => Promise<unknown> }
  const real = delegate.findMany
  let first = true
  delegate.findMany = (a: unknown) => {
    if (first) { first = false; return Promise.resolve([]) } // the check, before the attempt existed
    return real.call(delegate, a)
  }
  try {
    assert.equal((await call({ customerId: c.id, dates: [wat(1)], method: 'Cash', planId: plan.id })).status, 409)
  } finally {
    delegate.findMany = real
  }
  assert.equal(await wallet(), 100000)
  assert.equal(await prisma.transaction.count({ where: { planId: plan.id } }), 0)
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
