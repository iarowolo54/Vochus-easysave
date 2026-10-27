// Cross-path mutual exclusion (finding #5 follow-up): the agent redemption path
// must NOT be able to redeem a plan that has an active EarlyRedemption in flight,
// or the plan could be paid out twice. Runs against the worktree's local dev.db.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { loadOwnedRedeemablePlan } from '../src/lib/redemption'

const rid = Math.random().toString(36).slice(2, 10)
let agentId = ''
let customerId = ''
let planId = ''

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `XP-${rid}`, phone: `0706${rid}`, name: 'XP', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `CXP-${rid}`, agentId: a.id, firstName: 'C', lastName: 'X', phone: `0807${rid}`, address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
  const p = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 30, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 86400_000), balance: 5000, status: 'Active' },
  })
  planId = p.id
})

after(async () => {
  await prisma.earlyRedemption.deleteMany({ where: { savingsPlanId: planId } })
  await prisma.savingsPlan.deleteMany({ where: { id: planId } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('plan is redeemable by its agent when no early-redemption is active', async () => {
  assert.ok(await loadOwnedRedeemablePlan(agentId, customerId, planId))
})

test('plan is NOT agent-redeemable while an early-redemption is pending', async () => {
  const er = await prisma.earlyRedemption.create({
    data: { ref: `RED-${rid}`, savingsPlanId: planId, reason: 'x', status: 'Pending', balance: 5000, netPayout: 4500 },
  })
  try {
    assert.equal(await loadOwnedRedeemablePlan(agentId, customerId, planId), null)
  } finally {
    await prisma.earlyRedemption.delete({ where: { id: er.id } })
  }
})
