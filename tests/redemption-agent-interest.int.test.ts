// Agent-direct redemption path (api/transactions/redemption). The route authenticates via
// NextAuth getServerSession, which cannot be minted in-test, so this exercises the same
// computation + $transaction splice the handler performs: live accruedInterestForPlan,
// netPayout = money(gross - fee - comm + interest), and interestPayoutOps in one $transaction.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { accruedInterestForPlan } from '../src/lib/savings-interest-plan'
import { interestPayoutOps } from '../src/lib/redemption-interest-ops'
import { redemptionDeduction } from '../src/lib/wallet-rates'
import { claimPlanForRedemption } from '../src/lib/redemption'
import { money } from '../src/lib/wallet-guard'

const rid = Math.random().toString(36).slice(2, 8)
let agentId = ''
let customerId = ''
const planIds: string[] = []
let revenueDelta = 0

// Fixed schedule (the shared rate table is wiped concurrently by another test file).
const client = {
  transaction: prisma.transaction,
  savingsInterestRate: { findMany: async () => [{ effectiveFrom: new Date('2026-03-15T00:00:00Z'), annualRate: 6 }] },
} as unknown as Parameters<typeof accruedInterestForPlan>[0]

const START = new Date('2026-01-10T00:00:00Z')
const MATURITY = new Date('2026-07-10T00:00:00Z')
const AS_OF = new Date('2026-05-10T12:00:00Z')

async function mkPlan(source: string) {
  const p = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: START, maturityDate: MATURITY, balance: 1500, status: 'Active', source },
  })
  planIds.push(p.id)
  await prisma.transaction.create({ data: { ref: `RAI-${rid}-${p.id}-0`, agentId, customerId, planId: p.id, type: 'saving', amount: 1000, status: 'Done', createdAt: new Date('2026-01-10T00:00:00Z') } })
  await prisma.transaction.create({ data: { ref: `RAI-${rid}-${p.id}-1`, agentId, customerId, planId: p.id, type: 'saving', amount: 500, status: 'Done', createdAt: new Date('2026-02-20T00:00:00Z') } })
  return p
}

// Mirrors the route handler.
async function redeem(planId: string, ref: string) {
  const plan = await prisma.savingsPlan.findUniqueOrThrow({ where: { id: planId } })
  const gross = money(plan.balance)
  const rates = redemptionDeduction({ balance: plan.balance, dailyAmount: plan.dailyAmount, cadence: plan.cadence, hasCashDeposit: false, periodDays: plan.periodDays, initiator: 'admin', source: plan.source })
  const platformFee = money(rates.platform)
  const agentComm = money(rates.agent)
  const interest = await accruedInterestForPlan(client, plan, AS_OF)
  const netPayout = money(gross - platformFee - agentComm + interest)
  await prisma.$transaction(async (tx) => {
    assert.ok(await claimPlanForRedemption(tx, planId, plan.balance))
    await tx.transaction.create({ data: { ref, agentId, customerId, planId, type: 'redemption', amount: netPayout, method: 'Cash', status: 'Done' } })
    await tx.platformWallet.upsert({ where: { type: 'Revenue' }, update: { balance: { increment: platformFee } }, create: { type: 'Revenue', balance: platformFee } })
    for (const op of interestPayoutOps(tx, { ref, interestAmount: interest, savingsPlanId: planId }, agentId, customerId)) await op
  })
  revenueDelta += platformFee - interest
  return { gross, platformFee, agentComm, interest, netPayout }
}

const revenue = async () => (await prisma.platformWallet.findUnique({ where: { type: 'Revenue' } }))?.balance ?? 0

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `RAI-${rid}`, phone: `0794${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `RAI-C-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `0795${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
})

after(async () => {
  await prisma.transaction.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  // delta reversal of the shared Revenue balance
  if (revenueDelta !== 0) await prisma.platformWallet.update({ where: { type: 'Revenue' }, data: { balance: { increment: -revenueDelta } } })
  await prisma.$disconnect()
})

test('self plan: netPayout includes interest, Revenue -interest, -INT row written', async () => {
  const p = await mkPlan('self')
  const ref = `RAI-${rid}-S`
  const before = await revenue()
  const r = await redeem(p.id, ref)
  assert.equal(r.interest, 40)
  assert.equal(r.platformFee, 0)
  assert.equal(r.agentComm, 0)
  assert.equal(r.netPayout, 1540)
  assert.equal(money((await revenue()) - before), -40)
  const red = await prisma.transaction.findUnique({ where: { ref } })
  assert.equal(red?.amount, 1540)
  const int = await prisma.transaction.findUnique({ where: { ref: `${ref}-INT` } })
  assert.equal(int?.type, 'interest')
  assert.equal(int?.amount, 40)
  assert.equal(int?.planId, p.id)
})

test('agent plan: no interest, no -INT row, fee path unchanged', async () => {
  const p = await mkPlan('agent')
  const ref = `RAI-${rid}-A`
  const r = await redeem(p.id, ref)
  assert.equal(r.interest, 0)
  assert.equal(r.netPayout, money(r.gross - r.platformFee - r.agentComm))
  assert.equal(await prisma.transaction.findUnique({ where: { ref: `${ref}-INT` } }), null)
})
