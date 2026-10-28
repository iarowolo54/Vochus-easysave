// Proves the (customerId, startDate) unique index is gone (#7): two plans for
// one customer with the SAME start date can now be created without a 500.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'

const rid = Math.random().toString(36).slice(2, 8)
let agentId = ''
let customerId = ''

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `SD-${rid}`, phone: `0792${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `SD-${rid}`, agentId: a.id, firstName: 'C', lastName: 'D', phone: `0863${rid}`, address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
})

after(async () => {
  await prisma.savingsPlan.deleteMany({ where: { customerId } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('two plans with the same start date both persist', async () => {
  const startDate = new Date('2026-12-01T00:00:00')
  const mk = (goal: string) => prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 100, periodDays: 30, goal, startDate, maturityDate: new Date(startDate.getTime() + 30 * 86400_000), balance: 0, status: 'Active' },
  })
  await mk('Rent')
  await mk('School fees') // same startDate — would have thrown on the old unique index
  const count = await prisma.savingsPlan.count({ where: { customerId } })
  assert.equal(count, 2)
})
