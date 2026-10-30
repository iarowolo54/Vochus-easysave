// SR-3: a client-supplied deposit date must not backdate a deposit on an ONLINE
// (source:'self') plan, because interest accrues from deposit createdAt. OFFLINE
// (source:'agent') plans keep honoring it. The route handlers need a NextAuth
// session, so this drives the shared helper both routes use, plus selectActivePlan
// (which supplies the plan source) against the local dev.db.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { depositCreatedAt, selectActivePlan } from '../src/lib/saving-plan'

const rid = Math.random().toString(36).slice(2, 10)
let agentId = ''
let customerId = ''
const planIds: Record<string, string> = {}
const BACKDATED = '2026-01-05T12:00:00.000Z'

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `AB-${rid}`, phone: `0709${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `CB-${rid}`, agentId: a.id, firstName: 'C', lastName: 'C', phone: `0806${rid}`, address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
  for (const source of ['self', 'agent']) {
    const p = await prisma.savingsPlan.create({
      data: { customerId: c.id, dailyAmount: 100, periodDays: 30, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 86400_000), balance: 0, status: source === 'self' ? 'Active' : 'Completed', source },
    })
    planIds[source] = p.id
  }
})

after(async () => {
  await prisma.transaction.deleteMany({ where: { customerId } })
  await prisma.savingsPlan.deleteMany({ where: { customerId } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

async function deposit(source: 'self' | 'agent', date?: string) {
  const plan = await prisma.savingsPlan.findUniqueOrThrow({ where: { id: planIds[source] } })
  const createdAt = depositCreatedAt(plan.source, date)
  return prisma.transaction.create({
    data: {
      ref: `TXN-${rid}-${source}-${Math.random().toString(36).slice(2, 6)}`,
      agentId, customerId, planId: plan.id, type: 'saving', amount: 100, method: 'Cash', status: 'Done', walletAfter: 0,
      ...(createdAt ? { createdAt } : {}),
    },
  })
}

test('self plan: backdated date is ignored, createdAt is ~now', async () => {
  const start = Date.now()
  const t = await deposit('self', BACKDATED)
  assert.ok(t.createdAt.getTime() >= start - 1000, 'createdAt must not be the backdated value')
  assert.ok(Math.abs(t.createdAt.getTime() - Date.now()) < 5000)
})

test('agent plan: backdated date is honored', async () => {
  const t = await deposit('agent', BACKDATED)
  assert.equal(t.createdAt.toISOString(), BACKDATED)
})

test('agent plan without a date defaults to now', async () => {
  const start = Date.now()
  const t = await deposit('agent')
  assert.ok(t.createdAt.getTime() >= start - 1000)
})

test('selectActivePlan exposes the plan source', async () => {
  const r = await selectActivePlan(prisma, customerId, planIds.self)
  assert.ok('plan' in r)
  assert.equal((r as { plan: { source: string } }).plan.source, 'self')
})
