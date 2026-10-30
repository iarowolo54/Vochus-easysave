// Integration tests for collision-safe redemption creation. EarlyRedemption.token
// is @unique, but both creation paths draw a random 6-digit code and store its
// hash — two pending redemptions drawing the same code would collide and 500.
// createRedemptionWithUniqueCode retries on a token-unique violation (regenerating
// the code) and rethrows anything else. Runs against the worktree's local dev.db.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { hashRedemptionToken } from '../src/lib/redemption-token'
import { createRedemptionWithUniqueCode } from '../src/lib/redemption-create'

const rid = Math.random().toString(36).slice(2, 10)
let planId = ''
let customerId = ''
let agentId = ''
let n = 0

// buildData contract: receives the already-hashed token and returns the create
// input (matches how createRedemptionWithUniqueCode calls it).
function build(tokenHash: string) {
  return {
    ref: `RDX-${rid}-${n++}`,
    savingsPlanId: planId,
    reason: 'test',
    balance: 5000,
    netPayout: 4000,
    status: 'Pending',
    token: tokenHash,
    tokenExpiry: new Date(Date.now() + 30 * 60_000),
  }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `AC-${rid}`, phone: `0708${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: {
      customerId: `CC-${rid}`, agentId: a.id, firstName: 'C', lastName: 'C', phone: `0805${rid}`,
      address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800',
    },
  })
  customerId = c.id
  const p = await prisma.savingsPlan.create({
    data: {
      customerId: c.id, dailyAmount: 100, periodDays: 30, goal: 'x',
      startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 86400_000), balance: 5000, status: 'Active',
    },
  })
  planId = p.id
})

after(async () => {
  await prisma.earlyRedemption.deleteMany({ where: { ref: { startsWith: `RDX-${rid}-` } } })
  await prisma.savingsPlan.deleteMany({ where: { customerId } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('creates with the first code when there is no collision', async () => {
  const { redemption, code } = await createRedemptionWithUniqueCode(prisma, build, () => '424242')
  assert.equal(code, '424242')
  assert.equal(redemption.token, hashRedemptionToken('424242'))
})

test('retries past a colliding code and succeeds with the next one', async () => {
  // Occupy code '111111' on a prior pending redemption.
  await prisma.earlyRedemption.create({ data: build(hashRedemptionToken('111111')) })
  const codes = ['111111', '222222'] // first collides, second is free
  let i = 0
  const { redemption, code } = await createRedemptionWithUniqueCode(prisma, build, () => codes[i++])
  assert.equal(code, '222222', 'should skip the collision and use the free code')
  assert.equal(redemption.token, hashRedemptionToken('222222'))
  assert.equal(i, 2, 'should have called the generator exactly twice')
})

test('throws if every attempt collides (exhausts retries)', async () => {
  await prisma.earlyRedemption.create({ data: build(hashRedemptionToken('999999')) })
  await assert.rejects(
    createRedemptionWithUniqueCode(prisma, build, () => '999999', 4),
    /unique confirmation code/,
  )
})

test('rethrows a non-token unique violation immediately (e.g. duplicate ref)', async () => {
  const dupRef = `RDX-${rid}-dupref`
  await prisma.earlyRedemption.create({ data: { ...build(hashRedemptionToken('555555')), ref: dupRef } })
  let calls = 0
  // buildData always reuses the same (already-taken) ref -> P2002 on ref, not token.
  await assert.rejects(
    createRedemptionWithUniqueCode(prisma, (th) => ({ ...build(th), ref: dupRef }), () => { calls++; return `${700000 + calls}` }),
  )
  assert.equal(calls, 1, 'a ref collision must NOT be retried')
})
