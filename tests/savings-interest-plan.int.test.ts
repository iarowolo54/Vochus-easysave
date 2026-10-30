// Integration tests for accruedInterestForPlan: source gate + deposit-ledger filtering.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { accruedInterestForPlan } from '../src/lib/savings-interest-plan'

const rid = Math.random().toString(36).slice(2, 8)
let agentId = ''
let customerId = ''
const planIds: string[] = []

// Real transactions, but a fixed rate schedule: savings-interest-rate.int.test.ts wipes the
// shared SavingsInterestRate table concurrently, so reading it here would be racy.
const client = {
  transaction: prisma.transaction,
  savingsInterestRate: {
    findMany: async () => [{ effectiveFrom: new Date('2026-03-15T00:00:00Z'), annualRate: 6 }],
  },
} as unknown as Parameters<typeof accruedInterestForPlan>[0]

const START = new Date('2026-01-10T00:00:00Z')
const MATURITY = new Date('2026-07-10T00:00:00Z')
const AS_OF = new Date('2026-05-10T12:00:00Z')

async function mkPlan(source: string) {
  const p = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: START, maturityDate: MATURITY, balance: 0, status: 'Active', source },
  })
  planIds.push(p.id)
  let n = 0
  const tx = (type: string, amount: number, createdAt: Date) =>
    prisma.transaction.create({ data: { ref: `TX-${rid}-${p.id}-${n++}`, agentId, customerId, planId: p.id, type, amount, status: 'Done', createdAt } })
  await tx('saving', 1000, new Date('2026-01-10T00:00:00Z'))
  await tx('saving', 500, new Date('2026-02-20T00:00:00Z'))
  await tx('redemption', 300, new Date('2026-01-20T00:00:00Z'))
  return p
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `SIP-${rid}`, phone: `0792${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `SIP-C-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `0793${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
})

after(async () => {
  await prisma.transaction.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

// Anniversaries <= asOf: Feb10 (1000 @12% = 10), Mar10 (1500 @12% = 15),
// Apr10 (1500 @6% = 7.5), May10 (1500 @6% = 7.5) => 40. Redemption 300 excluded.
test('self plan: backdated deposits + mid-stream rate change, forward-only = 40', async () => {
  const p = await mkPlan('self')
  assert.equal(await accruedInterestForPlan(client, p, AS_OF), 40)
})

test('agent plan with identical data earns 0 (scope gate)', async () => {
  const p = await mkPlan('agent')
  assert.equal(await accruedInterestForPlan(client, p, AS_OF), 0)
})

test('non-saving ledger rows are excluded from the base', async () => {
  const p = await mkPlan('self')
  // If the 300 redemption were counted: 10.0+... would exceed 40.
  const v = await accruedInterestForPlan(client, p, AS_OF)
  assert.equal(v, 40)
  await prisma.transaction.create({ data: { ref: `TX-${rid}-big`, agentId, customerId, planId: p.id, type: 'redemption', amount: 100000, status: 'Done', createdAt: new Date('2026-01-11T00:00:00Z') } })
  assert.equal(await accruedInterestForPlan(client, p, AS_OF), 40)
})
