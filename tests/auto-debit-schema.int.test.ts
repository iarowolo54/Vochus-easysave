// Proof that the AutoDebitMandate / AutoDebitAttempt tables exist with the
// expected defaults and uniqueness. Rows are scoped by a unique run id.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'

const rid = Math.random().toString(36).slice(2, 8)
let agentId = ''
let customerId = ''
let planId = ''
let mandateId = ''
const attemptIds: string[] = []

before(async () => {
  const a = await prisma.agent.create({
    data: { agentId: `ADS-${rid}`, phone: `0708${rid}`, name: 'Ads', location: 'x', password: 'x' },
  })
  agentId = a.id
  const c = await prisma.customer.create({
    data: {
      customerId: `ADS-C-${rid}`, agentId, firstName: 'A', lastName: 'B', phone: `0707${rid}`,
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
  await prisma.autoDebitAttempt.deleteMany({ where: { id: { in: attemptIds } } })
  if (mandateId) await prisma.autoDebitMandate.deleteMany({ where: { id: mandateId } })
  await prisma.savingsPlan.deleteMany({ where: { id: planId } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('mandate and attempt persist with defaults; attempt reference is unique', async () => {
  const m = await prisma.autoDebitMandate.create({
    data: {
      customerId, savingsPlanId: planId, authorizationCode: `AUTH_${rid}`,
      authSignature: `SIG_${rid}`, authEmail: 'a@b.co', amountPerCycle: 100, nextRunAt: new Date(),
    },
  })
  mandateId = m.id
  assert.equal(m.status, 'pending')
  assert.equal(m.channel, 'card')
  assert.equal(m.reusable, false)
  assert.equal(m.consecutiveFailures, 0)
  assert.ok(m.consentAt instanceof Date)

  const data = {
    mandateId, savingsPlanId: planId, reference: `ADS-REF-${rid}`, cycleDate: new Date(),
    creditAmount: 100, grossCharged: 101.5, feeEstimate: 1.5,
  }
  const at = await prisma.autoDebitAttempt.create({ data })
  attemptIds.push(at.id)
  assert.equal(at.status, 'pending')
  assert.equal(at.settledAmount, null)

  await assert.rejects(prisma.autoDebitAttempt.create({ data }), (e: unknown) => (e as { code?: string }).code === 'P2002')

  await assert.rejects(
    prisma.autoDebitMandate.create({
      data: { customerId, savingsPlanId: planId, authorizationCode: 'x', authSignature: 'x', authEmail: 'x', amountPerCycle: 1, nextRunAt: new Date() },
    }),
    (e: unknown) => (e as { code?: string }).code === 'P2002',
  )
})
