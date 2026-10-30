// Integration test: interestPayoutOps debits the platform Revenue wallet and writes the interest ledger row.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { interestPayoutOps } from '../src/lib/redemption-interest-ops'

const rid = Math.random().toString(36).slice(2, 8)
let agentId = ''
let customerId = ''
let planId = ''
let revenueBefore: number | null = null // null = row did not exist before the test

async function revenue() {
  return (await prisma.platformWallet.findUnique({ where: { type: 'Revenue' } }))?.balance ?? null
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `RIO-${rid}`, phone: `0796${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `RIO-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `08${rid}1`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
  const p = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 1e10), balance: 1000, status: 'Active', source: 'self' },
  })
  planId = p.id
  revenueBefore = await revenue()
  await prisma.platformWallet.upsert({ where: { type: 'Revenue' }, update: { balance: { increment: 0 } }, create: { type: 'Revenue', balance: 0 } })
})

after(async () => {
  await prisma.transaction.deleteMany({ where: { planId } })
  await prisma.savingsPlan.deleteMany({ where: { id: planId } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  if (revenueBefore === null) await prisma.platformWallet.deleteMany({ where: { type: 'Revenue' } })
  else await prisma.platformWallet.update({ where: { type: 'Revenue' }, data: { balance: revenueBefore } })
  await prisma.$disconnect()
})

test('interestAmount 50: Revenue debited by 50 and an interest Transaction is written', async () => {
  const start = (await revenue()) ?? 0
  const ref = `ER-${rid}-A`
  await prisma.$transaction(interestPayoutOps(prisma, { ref, interestAmount: 50, savingsPlanId: planId }, agentId, customerId))
  const end = (await revenue()) ?? 0
  assert.equal(end - start, -50)
  const tx = await prisma.transaction.findUniqueOrThrow({ where: { ref: `${ref}-INT` } })
  assert.equal(tx.type, 'interest')
  assert.equal(tx.amount, 50)
  assert.equal(tx.agentId, agentId)
  assert.equal(tx.customerId, customerId)
  assert.equal(tx.planId, planId)
  assert.equal(tx.status, 'Done')
})

test('interestAmount 0: no ops, no debit, no row', async () => {
  const start = await revenue()
  const ref = `ER-${rid}-B`
  const ops = interestPayoutOps(prisma, { ref, interestAmount: 0, savingsPlanId: planId }, agentId, customerId)
  assert.deepEqual(ops, [])
  await prisma.$transaction(ops)
  assert.equal(await revenue(), start)
  assert.equal(await prisma.transaction.count({ where: { ref: `${ref}-INT` } }), 0)
})
