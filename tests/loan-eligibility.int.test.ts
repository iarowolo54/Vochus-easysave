// Integration tests for loadLoanEligibilityContext: ownership scoping (IDOR),
// the Active-plan savings sum, and active-loan detection — against the
// worktree's own local prisma/dev.db.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { loadLoanEligibilityContext } from '../src/lib/loan-eligibility'

const rid = Math.random().toString(36).slice(2, 10)
let agentA = ''
let agentB = ''
let customerB = ''

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `LA-${rid}`, phone: `0711${rid}`, name: 'A', location: 'x', password: 'x' } })
  const b = await prisma.agent.create({ data: { agentId: `LB-${rid}`, phone: `0712${rid}`, name: 'B', location: 'x', password: 'x' } })
  agentA = a.id; agentB = b.id
  const c = await prisma.customer.create({
    data: {
      customerId: `LC-${rid}`, agentId: b.id, firstName: 'Cust', lastName: 'B', phone: `0813${rid}`,
      address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800',
    },
  })
  customerB = c.id
  // Two Active plans (summed) + one Redeemed plan that must be ignored.
  await prisma.savingsPlan.createMany({
    data: [
      { customerId: c.id, dailyAmount: 100, periodDays: 30, goal: 'x', startDate: new Date(Date.now() - 2 * 86400_000), maturityDate: new Date(Date.now() + 30 * 86400_000), balance: 3000, status: 'Active' },
      { customerId: c.id, dailyAmount: 100, periodDays: 30, goal: 'x', startDate: new Date(Date.now() - 1 * 86400_000), maturityDate: new Date(Date.now() + 30 * 86400_000), balance: 2000, status: 'Active' },
      { customerId: c.id, dailyAmount: 100, periodDays: 30, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 86400_000), balance: 9999, status: 'Redeemed' },
    ],
  })
})

after(async () => {
  await prisma.loan.deleteMany({ where: { customerId: customerB } })
  await prisma.savingsPlan.deleteMany({ where: { customerId: customerB } })
  await prisma.customer.deleteMany({ where: { id: customerB } })
  await prisma.agent.deleteMany({ where: { id: { in: [agentA, agentB] } } })
  await prisma.$disconnect()
})

test('a non-owning agent gets null (IDOR closed)', async () => {
  assert.equal(await loadLoanEligibilityContext(prisma, agentA, customerB), null)
})

test('the owning agent sees the summed Active-plan balance, Redeemed excluded', async () => {
  const ctx = await loadLoanEligibilityContext(prisma, agentB, customerB)
  assert.ok(ctx)
  assert.equal(ctx!.savingsBalance, 5000)
  assert.equal(ctx!.hasActiveLoan, false)
})

test('a Pending loan makes the customer ineligible', async () => {
  const loan = await prisma.loan.create({
    data: {
      ref: `LNR-INT-${rid}`, agentId: agentB, customerId: customerB, principal: 100, interestRate: 10,
      interestAmount: 10, totalAmount: 110, durationDays: 30, dueDate: new Date(Date.now() + 30 * 86400_000), status: 'Pending',
    },
  })
  const ctx = await loadLoanEligibilityContext(prisma, agentB, customerB)
  assert.equal(ctx!.hasActiveLoan, true)
  await prisma.loan.delete({ where: { id: loan.id } })
})
