// Integration tests for the redemption ownership + atomic-claim logic
// (finding #1: an agent could redeem ANY customer's plan and self-credit).
// Runs against the worktree's own local prisma/dev.db.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { loadOwnedRedeemablePlan, claimPlanForRedemption } from '../src/lib/redemption'

const rid = Math.random().toString(36).slice(2, 10)
let agentA = ''
let agentB = ''
let customerB = ''
let planB = ''

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `A-${rid}`, phone: `0701${rid}`, name: 'A', location: 'x', password: 'x' } })
  const b = await prisma.agent.create({ data: { agentId: `B-${rid}`, phone: `0702${rid}`, name: 'B', location: 'x', password: 'x' } })
  agentA = a.id; agentB = b.id
  const c = await prisma.customer.create({
    data: {
      customerId: `C-${rid}`, agentId: b.id, firstName: 'Cust', lastName: 'B', phone: `0803${rid}`,
      address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800',
    },
  })
  customerB = c.id
  const p = await prisma.savingsPlan.create({
    data: {
      customerId: c.id, dailyAmount: 100, periodDays: 30, goal: 'x',
      startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 86400_000), balance: 5000, status: 'Active',
    },
  })
  planB = p.id
})

after(async () => {
  await prisma.savingsPlan.deleteMany({ where: { customerId: customerB } })
  await prisma.customer.deleteMany({ where: { id: customerB } })
  await prisma.agent.deleteMany({ where: { id: { in: [agentA, agentB] } } })
  await prisma.$disconnect()
})

test('a non-owning agent cannot load the plan (IDOR closed)', async () => {
  const seen = await loadOwnedRedeemablePlan(agentA, customerB, planB)
  assert.equal(seen, null)
})

test('the owning agent loads the plan', async () => {
  const seen = await loadOwnedRedeemablePlan(agentB, customerB, planB)
  assert.ok(seen && seen.id === planB)
})

test('concurrent claims redeem the plan exactly once (no double-spend)', async () => {
  const results = await Promise.all([
    claimPlanForRedemption(prisma, planB),
    claimPlanForRedemption(prisma, planB),
    claimPlanForRedemption(prisma, planB),
  ])
  assert.equal(results.filter(Boolean).length, 1)
  const after = await prisma.savingsPlan.findUnique({ where: { id: planB } })
  assert.equal(after?.balance, 0)
  assert.equal(after?.status, 'Redeemed')
  // once redeemed, it is no longer loadable/claimable
  assert.equal(await loadOwnedRedeemablePlan(agentB, customerB, planB), null)
  assert.equal(await claimPlanForRedemption(prisma, planB), false)
})
