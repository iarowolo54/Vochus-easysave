// SR-4: online (source:'self') plans must NOT be redeemable through the agent-direct path
// (api/transactions/redemption), which bypasses customer-OTP + admin approval. The route's
// only plan lookup is loadOwnedRedeemablePlan (NextAuth session can't be minted in-test),
// so we test that helper: it excludes self plans and still returns agent plans.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { loadOwnedRedeemablePlan } from '../src/lib/redemption'

const rid = Math.random().toString(36).slice(2, 8)
let agentId = ''
let customerId = ''
const planIds: string[] = []

async function mkPlan(source: string) {
  const p = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 100, periodDays: 30, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 86400_000), balance: 1500, status: 'Active', source },
  })
  planIds.push(p.id)
  return p
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `RAB-${rid}`, phone: `0796${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `RAB-C-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `0797${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
})

after(async () => {
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('agent-direct redemption cannot load an online (self) plan', async () => {
  const p = await mkPlan('self')
  assert.equal(await loadOwnedRedeemablePlan(agentId, customerId, p.id), null)
  const row = await prisma.savingsPlan.findUniqueOrThrow({ where: { id: p.id } })
  assert.equal(row.status, 'Active')
  assert.equal(row.balance, 1500)
})

test('agent-direct redemption still loads an agent plan', async () => {
  const p = await mkPlan('agent')
  const seen = await loadOwnedRedeemablePlan(agentId, customerId, p.id)
  assert.equal(seen?.id, p.id)
})
