// Integration test for the disburse-time one-loan guard: a customer must not
// have two loans disbursed at once, even if an admin approved both (closes the
// request-time TOCTOU at the money boundary). Against the worktree dev.db.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { customerHasOtherDisbursedLoan } from '../src/lib/loan-eligibility'

const rid = Math.random().toString(36).slice(2, 10)
let agentId = ''
let customerId = ''
let disbursedLoanId = ''
let approvedLoanId = ''

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `DG-${rid}`, phone: `0721${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: {
      customerId: `DC-${rid}`, agentId: a.id, firstName: 'C', lastName: 'B', phone: `0823${rid}`,
      address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800',
    },
  })
  customerId = c.id
  const mk = (ref: string, status: string) => prisma.loan.create({
    data: {
      ref, agentId: a.id, customerId: c.id, principal: 100, interestRate: 10, interestAmount: 10,
      totalAmount: 110, durationDays: 30, dueDate: new Date(Date.now() + 30 * 86400_000), status,
    },
  })
  disbursedLoanId = (await mk(`DG1-${rid}`, 'Disbursed')).id
  approvedLoanId = (await mk(`DG2-${rid}`, 'Approved')).id
})

after(async () => {
  await prisma.loan.deleteMany({ where: { customerId } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('reports another disbursed loan exists (excluding the loan being disbursed)', async () => {
  // Disbursing the still-Approved loan must see the customer already has one out.
  assert.equal(await customerHasOtherDisbursedLoan(prisma, customerId, approvedLoanId), true)
})

test('the loan being disbursed does not count itself', async () => {
  // If the only Disbursed loan is the one we are disbursing, there is no OTHER.
  assert.equal(await customerHasOtherDisbursedLoan(prisma, customerId, disbursedLoanId), false)
})

test('a customer with no disbursed loan is clear', async () => {
  const c2 = await prisma.customer.create({
    data: {
      customerId: `DC2-${rid}`, agentId, firstName: 'C', lastName: 'C', phone: `0824${rid}`,
      address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800',
    },
  })
  assert.equal(await customerHasOtherDisbursedLoan(prisma, c2.id, 'nonexistent'), false)
  await prisma.customer.deleteMany({ where: { id: c2.id } })
})
