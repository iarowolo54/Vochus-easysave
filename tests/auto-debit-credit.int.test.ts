// Integration tests for creditAutoDebitAttempt: atomic, idempotent credit.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { creditAutoDebitAttempt } from '../src/lib/auto-debit-credit'

const rid = Math.random().toString(36).slice(2, 8)
let agentId = ''
let customerId = ''
let planId = ''
let mandateId = ''
let attemptId = ''
const reference = `ADC-${rid}`

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `ADC-${rid}`, phone: `0794${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `ADC-C-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `0795${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
  const p = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 700, periodDays: 30, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 864e5), balance: 100, status: 'Active', source: 'self' },
  })
  planId = p.id
  const m = await prisma.autoDebitMandate.create({
    data: { customerId, savingsPlanId: planId, authorizationCode: `AUTH_${rid}`, authSignature: 'sig', authEmail: 'a@b.c', status: 'active', amountPerCycle: 700, nextRunAt: new Date(), consecutiveFailures: 2 },
  })
  mandateId = m.id
  const at = await prisma.autoDebitAttempt.create({
    data: { mandateId, savingsPlanId: planId, reference, cycleDate: new Date(), creditAmount: 700, grossCharged: 710, feeEstimate: 10, status: 'processing' },
  })
  attemptId = at.id
})

after(async () => {
  await prisma.transaction.deleteMany({ where: { planId } })
  await prisma.autoDebitAttempt.deleteMany({ where: { id: attemptId } })
  await prisma.autoDebitMandate.deleteMany({ where: { id: mandateId } })
  await prisma.savingsPlan.deleteMany({ where: { id: planId } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('credits once, then is idempotent; unknown ref is not_found', async () => {
  assert.equal(await creditAutoDebitAttempt(prisma, { reference, settledAmountNaira: 710 }), 'credited')
  const plan = await prisma.savingsPlan.findUnique({ where: { id: planId } })
  assert.equal(plan?.balance, 800)
  const txs = await prisma.transaction.findMany({ where: { planId, type: 'saving' } })
  assert.equal(txs.length, 1)
  assert.equal(txs[0].ref, reference)
  assert.equal(txs[0].amount, 700)
  assert.equal(txs[0].agentId, agentId)
  const at = await prisma.autoDebitAttempt.findUnique({ where: { id: attemptId } })
  assert.equal(at?.status, 'success')
  assert.equal(at?.settledAmount, 710)
  const m = await prisma.autoDebitMandate.findUnique({ where: { id: mandateId } })
  assert.equal(m?.consecutiveFailures, 0)

  assert.equal(await creditAutoDebitAttempt(prisma, { reference, settledAmountNaira: 710 }), 'already')
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: planId } }))?.balance, 800)
  assert.equal(await prisma.transaction.count({ where: { planId, type: 'saving' } }), 1)

  assert.equal(await creditAutoDebitAttempt(prisma, { reference: `nope-${rid}`, settledAmountNaira: 1 }), 'not_found')
})

test('a charge landing on a closed plan is not credited and goes to manual review, once', async () => {
  const closedRef = `autodebit-closed-${rid}`
  const closed = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 700, periodDays: 30, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 864e5), balance: 100, status: 'Redeemed', source: 'self' },
  })
  const at = await prisma.autoDebitAttempt.create({
    data: { mandateId, savingsPlanId: closed.id, reference: closedRef, cycleDate: new Date(), creditAmount: 700, grossCharged: 710, feeEstimate: 10, status: 'processing' },
  })
  try {
    assert.equal(await creditAutoDebitAttempt(prisma, { reference: closedRef, settledAmountNaira: 710 }), 'review')
    assert.equal(await creditAutoDebitAttempt(prisma, { reference: closedRef, settledAmountNaira: 710 }), 'review')
    assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: closed.id } })).balance, 100)
    assert.equal(await prisma.transaction.count({ where: { ref: closedRef } }), 0)
    assert.equal((await prisma.autoDebitAttempt.findUniqueOrThrow({ where: { id: at.id } })).status, 'review')
    assert.equal(await prisma.auditLog.count({ where: { action: 'payment_needs_manual_review', entityId: at.id } }), 1)
  } finally {
    await prisma.autoDebitAttempt.deleteMany({ where: { id: at.id } })
    await prisma.savingsPlan.deleteMany({ where: { id: closed.id } })
  }
})

test('a plan redeemed between the read and the credit takes no money, and nothing partial is left', async () => {
  const racingRef = `autodebit-race-${rid}`
  const open = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 700, periodDays: 30, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 864e5), balance: 100, status: 'Active', source: 'self' },
  })
  const at = await prisma.autoDebitAttempt.create({
    data: { mandateId, savingsPlanId: open.id, reference: racingRef, cycleDate: new Date(), creditAmount: 700, grossCharged: 710, feeEstimate: 10, status: 'processing' },
  })
  // The credit reads the plan, then the customer, then credits: redeem it in between.
  const racing = new Proxy(prisma, {
    get(target, key) {
      if (key !== 'customer') return Reflect.get(target, key)
      return { findUnique: async (a: Parameters<typeof prisma.customer.findUnique>[0]) => {
        await prisma.savingsPlan.update({ where: { id: open.id }, data: { status: 'Redeemed' } })
        return prisma.customer.findUnique(a)
      } }
    },
  })
  try {
    assert.equal(await creditAutoDebitAttempt(racing, { reference: racingRef, settledAmountNaira: 710 }), 'review')
    assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: open.id } })).balance, 100)
    assert.equal(await prisma.transaction.count({ where: { ref: racingRef } }), 0)
    assert.equal((await prisma.autoDebitAttempt.findUniqueOrThrow({ where: { id: at.id } })).status, 'review')
  } finally {
    await prisma.autoDebitAttempt.deleteMany({ where: { id: at.id } })
    await prisma.savingsPlan.deleteMany({ where: { id: open.id } })
  }
})
