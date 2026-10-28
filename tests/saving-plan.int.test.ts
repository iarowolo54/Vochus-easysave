// Integration tests for selectActivePlan (#7): explicit planId scoped to the
// customer, and the single/ambiguous/none behaviour with no planId.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { selectActivePlan } from '../src/lib/saving-plan'

const rid = Math.random().toString(36).slice(2, 8)
let custA = ''   // will have two active plans
let custB = ''   // will have one active plan
let otherCust = ''
let planA1 = ''
let planB1 = ''

const mkCustomer = (sfx: string) => prisma.customer.create({
  data: { customerId: `SP-${sfx}-${rid}`, agentId: agentId, firstName: 'C', lastName: sfx, phone: `08${sfx}${rid}`.slice(0, 11).padEnd(11, '0'), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
})
let agentId = ''

const mkPlan = (customerId: string, startDate: Date, status = 'Active') => prisma.savingsPlan.create({
  data: { customerId, dailyAmount: 100, periodDays: 30, goal: 'x', startDate, maturityDate: new Date(startDate.getTime() + 30 * 86400_000), balance: 0, status },
})

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `SPA-${rid}`, phone: `0791${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const A = await mkCustomer('A'); custA = A.id
  const B = await mkCustomer('B'); custB = B.id
  const O = await mkCustomer('O'); otherCust = O.id
  planA1 = (await mkPlan(custA, new Date(Date.now() - 2 * 86400_000))).id
  await mkPlan(custA, new Date(Date.now() - 1 * 86400_000)) // second active plan for A
  planB1 = (await mkPlan(custB, new Date())).id
})

after(async () => {
  await prisma.savingsPlan.deleteMany({ where: { customerId: { in: [custA, custB, otherCust] } } })
  await prisma.customer.deleteMany({ where: { id: { in: [custA, custB, otherCust] } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('explicit planId that belongs to the customer resolves', async () => {
  const r = await selectActivePlan(prisma, custA, planA1)
  assert.deepEqual(r, { plan: { id: planA1 } })
})

test("another customer's planId is rejected (IDOR-safe)", async () => {
  const r = await selectActivePlan(prisma, otherCust, planA1)
  assert.deepEqual(r, { error: 'not_found' })
})

test('no planId with multiple active plans is ambiguous', async () => {
  assert.deepEqual(await selectActivePlan(prisma, custA), { error: 'ambiguous' })
})

test('no planId with exactly one active plan resolves to it', async () => {
  assert.deepEqual(await selectActivePlan(prisma, custB), { plan: { id: planB1 } })
})

test('no planId with no active plan returns none', async () => {
  assert.deepEqual(await selectActivePlan(prisma, otherCust), { error: 'none' })
})
