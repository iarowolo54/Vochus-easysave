// Integration tests for the redemption token-attempt cap (brute-force findings:
// agent verify-token and customer/redeem PATCH both validate the same 6-digit
// confirmation code with no cap). reserveRedemptionAttempt atomically counts an
// attempt against a Pending redemption and refuses once the cap is reached, so a
// session-hijacker (customer path) or a rogue agent (agent path) cannot guess
// the code. Runs against the worktree's own local prisma/dev.db.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { reserveRedemptionAttempt, REDEMPTION_ATTEMPT_LIMIT } from '../src/lib/redemption-attempts'

const rid = Math.random().toString(36).slice(2, 10)
let agentId = ''
let customerId = ''
let planId = ''

async function newRedemption(suffix: string, status = 'Pending') {
  return prisma.earlyRedemption.create({
    data: {
      ref: `RED-${rid}-${suffix}`,
      savingsPlanId: planId,
      reason: 'test',
      balance: 5000,
      netPayout: 4000,
      status,
      token: `hash-${rid}-${suffix}`,
      tokenExpiry: new Date(Date.now() + 30 * 60_000),
    },
  })
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `AR-${rid}`, phone: `0709${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: {
      customerId: `CR-${rid}`, agentId: a.id, firstName: 'C', lastName: 'R', phone: `0804${rid}`,
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
  await prisma.earlyRedemption.deleteMany({ where: { ref: { startsWith: `RED-${rid}-` } } })
  await prisma.savingsPlan.deleteMany({ where: { customerId } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('the limit is small enough to stop brute force but allows a few typos', () => {
  assert.ok(REDEMPTION_ATTEMPT_LIMIT >= 3 && REDEMPTION_ATTEMPT_LIMIT <= 10, `limit=${REDEMPTION_ATTEMPT_LIMIT}`)
})

test('reserves exactly LIMIT attempts on a Pending redemption, then refuses', async () => {
  const r = await newRedemption('cap')
  for (let i = 0; i < REDEMPTION_ATTEMPT_LIMIT; i++) {
    assert.equal(await reserveRedemptionAttempt(prisma, r.ref), true, `attempt ${i + 1} should be allowed`)
  }
  assert.equal(await reserveRedemptionAttempt(prisma, r.ref), false, 'over the cap must be refused')
  const row = await prisma.earlyRedemption.findUnique({ where: { ref: r.ref } })
  assert.equal(row?.attempts, REDEMPTION_ATTEMPT_LIMIT, 'attempts never exceed the cap')
})

test('refuses once the redemption is no longer Pending (already validated)', async () => {
  const r = await newRedemption('validated', 'TokenValidated')
  assert.equal(await reserveRedemptionAttempt(prisma, r.ref), false)
})

test('refuses for a ref that does not exist', async () => {
  assert.equal(await reserveRedemptionAttempt(prisma, `RED-${rid}-nope`), false)
})

test('concurrent attempts are counted atomically and never exceed the cap', async () => {
  const r = await newRedemption('race')
  const tries = REDEMPTION_ATTEMPT_LIMIT + 8
  const results = await Promise.all(
    Array.from({ length: tries }, () => reserveRedemptionAttempt(prisma, r.ref)),
  )
  assert.equal(results.filter(Boolean).length, REDEMPTION_ATTEMPT_LIMIT, 'exactly LIMIT reservations succeed')
  const row = await prisma.earlyRedemption.findUnique({ where: { ref: r.ref } })
  assert.equal(row?.attempts, REDEMPTION_ATTEMPT_LIMIT)
})
