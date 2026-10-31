// PlanDayCoverage records which scheduled days a catch-up payment covers.
// Rows are scoped by a unique run id and deleted by id in teardown.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'

const rid = Math.random().toString(36).slice(2, 8)
let agentId = ''
let customerId = ''
let planId = ''
const coverageIds: string[] = []
const intentIds: string[] = []

before(async () => {
  const a = await prisma.agent.create({
    data: { agentId: `PDC-${rid}`, phone: `0708${rid}`, name: 'Pdc', location: 'x', password: 'x' },
  })
  agentId = a.id
  const c = await prisma.customer.create({
    data: {
      customerId: `PDC-C-${rid}`, agentId, firstName: 'A', lastName: 'B', phone: `0707${rid}`,
      address: 'x', nokName: 'x', nokRelation: 'x', nokPhone: 'x',
    },
  })
  customerId = c.id
  const p = await prisma.savingsPlan.create({
    data: {
      customerId, dailyAmount: 100, periodDays: 30, goal: 'test',
      startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 86400000),
    },
  })
  planId = p.id
})

after(async () => {
  await prisma.planDayCoverage.deleteMany({ where: { id: { in: coverageIds } } })
  await prisma.paymentIntent.deleteMany({ where: { id: { in: intentIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: planId } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('PlanDayCoverage rejects a duplicate (savingsPlanId, coversKey)', async () => {
  const row = await prisma.planDayCoverage.create({
    data: { savingsPlanId: planId, coversKey: '2026-10-01', ref: `REF-A-${rid}` },
  })
  coverageIds.push(row.id)
  assert.ok(row.createdAt)

  await assert.rejects(
    prisma.planDayCoverage.create({
      data: { savingsPlanId: planId, coversKey: '2026-10-01', ref: `REF-B-${rid}` },
    }),
    (e: unknown) => (e as { code?: string }).code === 'P2002',
  )

  const other = await prisma.planDayCoverage.create({
    data: { savingsPlanId: planId, coversKey: '2026-10-02', ref: `REF-A-${rid}` },
  })
  coverageIds.push(other.id)
})

test('PaymentIntent.coversKeys is nullable and stores a JSON array', async () => {
  const keys = JSON.stringify(['2026-10-01', '2026-10-02'])
  const i = await prisma.paymentIntent.create({
    data: { ref: `PDC-I-${rid}`, actorType: 'customer', customerId, planId, amount: 200, coversKeys: keys },
  })
  intentIds.push(i.id)
  assert.deepEqual(JSON.parse(i.coversKeys as string), ['2026-10-01', '2026-10-02'])
  const j = await prisma.paymentIntent.create({
    data: { ref: `PDC-J-${rid}`, actorType: 'customer', customerId, planId, amount: 100 },
  })
  intentIds.push(j.id)
  assert.equal(j.coversKeys, null)
})
