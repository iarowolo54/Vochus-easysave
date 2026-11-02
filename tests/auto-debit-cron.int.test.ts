// Integration tests for the auto-debit cron passes (test-mode Paystack, real prisma).
process.env.PAYSTACK_SECRET_KEY = 'sk_test_cron'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { runDueAutoDebits, reconcileProcessingAttempts } from '../src/lib/auto-debit-run'

const rid = Math.random().toString(36).slice(2, 8)
const now = new Date('2031-03-10T09:00:00Z')
const DAY = 864e5
let agentId = ''
let customerId = ''
const planIds: string[] = []
const mandateIds: string[] = []

async function seedPlan(opts: { maturityDate: Date; status?: string; cadence?: string; startDate?: Date }) {
  const p = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 500, periodDays: 90, cadence: opts.cadence ?? 'weekly', goal: 'x', startDate: opts.startDate ?? new Date(now.getTime() - 7 * DAY), maturityDate: opts.maturityDate, balance: 100, status: opts.status ?? 'Active', source: 'self' },
  })
  planIds.push(p.id)
  const m = await prisma.autoDebitMandate.create({
    data: { customerId, savingsPlanId: p.id, authorizationCode: `AUTH_${rid}`, authSignature: 'sig', authEmail: 'a@b.c', status: 'active', amountPerCycle: 500, nextRunAt: new Date(now.getTime() - 1000) },
  })
  mandateIds.push(m.id)
  return { plan: p, mandate: m }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `ADR-${rid}`, phone: `0796${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `ADR-C-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `0797${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
})

after(async () => {
  await prisma.planDayCoverage.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.transaction.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.autoDebitAttempt.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.autoDebitMandate.deleteMany({ where: { id: { in: mandateIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('charges a due mandate once; same-day rerun is idempotent', async () => {
  const { plan, mandate } = await seedPlan({ maturityDate: new Date(now.getTime() + 60 * DAY) })
  const r1 = await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] })
  assert.deepEqual(r1, { charged: 1, skipped: 0, failed: 0, pending: 0 })
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 600)
  const attempts = await prisma.autoDebitAttempt.findMany({ where: { savingsPlanId: plan.id } })
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].status, 'success')
  assert.equal(attempts[0].reference, 'autodebit-' + plan.id + '-20310310')
  const m = await prisma.autoDebitMandate.findUnique({ where: { id: mandate.id } })
  assert.ok(m!.nextRunAt.getTime() > now.getTime())

  // Force it due again the same day: reference collision must skip.
  await prisma.autoDebitMandate.update({ where: { id: mandate.id }, data: { nextRunAt: new Date(now.getTime() - 1000) } })
  const r2 = await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] })
  assert.deepEqual(r2, { charged: 0, skipped: 1, failed: 0, pending: 0 })
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 600)
  assert.equal(await prisma.autoDebitAttempt.count({ where: { savingsPlanId: plan.id } }), 1)
  assert.equal(await prisma.transaction.count({ where: { planId: plan.id } }), 1)
})

test('a plan past maturity is not charged', async () => {
  const { plan, mandate } = await seedPlan({ maturityDate: new Date(now.getTime() - DAY) })
  await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] })
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 100)
  assert.equal(await prisma.autoDebitAttempt.count({ where: { savingsPlanId: plan.id } }), 0)
})

test('reconcile settles a stale processing attempt exactly once', async () => {
  const { plan, mandate } = await seedPlan({ maturityDate: new Date(now.getTime() + 60 * DAY) })
  await prisma.autoDebitMandate.update({ where: { id: mandate.id }, data: { nextRunAt: new Date(now.getTime() + 7 * DAY) } })
  const reference = `autodebit-${plan.id}-20310301`
  await prisma.autoDebitAttempt.create({
    data: { mandateId: mandate.id, savingsPlanId: plan.id, reference, cycleDate: now, creditAmount: 500, grossCharged: 508, feeEstimate: 8, status: 'processing', createdAt: new Date(now.getTime() - 3 * 3600e3) },
  })
  const scope = { mandateIds: [mandate.id] }
  const r1 = await reconcileProcessingAttempts(prisma, now, undefined, scope)
  assert.deepEqual(r1, { settled: 1, failed: 0 })
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 600)
  const at = await prisma.autoDebitAttempt.findUnique({ where: { reference } })
  assert.equal(at?.status, 'success')
  assert.equal(at?.settledAmount, 508)
  assert.deepEqual(await reconcileProcessingAttempts(prisma, now, undefined, scope), { settled: 0, failed: 0 })
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 600)
  assert.equal(await prisma.transaction.count({ where: { planId: plan.id } }), 1)
})

const covers = (savingsPlanId: string, coversKey: string) =>
  prisma.planDayCoverage.create({ data: { savingsPlanId, coversKey, ref: `pre-${rid}-${coversKey}` } })

test('a covered daily cycle is not charged, the schedule advances, and the next uncovered cycle is charged', async () => {
  const { plan, mandate } = await seedPlan({ maturityDate: new Date(now.getTime() + 60 * DAY), cadence: 'daily' })
  await prisma.autoDebitMandate.update({ where: { id: mandate.id }, data: { consecutiveFailures: 2 } })
  await covers(plan.id, '2031-03-10')
  const scope = { mandateIds: [mandate.id] }

  assert.deepEqual(await runDueAutoDebits(prisma, now, scope), { charged: 0, skipped: 1, failed: 0, pending: 0 })
  assert.equal(await prisma.autoDebitAttempt.count({ where: { savingsPlanId: plan.id } }), 0)
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 100)
  const m = await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: mandate.id } })
  assert.equal(m.nextRunAt.toISOString(), new Date(now.getTime() + DAY).toISOString())
  assert.equal(m.consecutiveFailures, 2, 'a skip is neither a failure nor a success')

  // Next day is not covered: charged as normal.
  const tomorrow = new Date(now.getTime() + DAY)
  assert.deepEqual(await runDueAutoDebits(prisma, tomorrow, scope), { charged: 1, skipped: 0, failed: 0, pending: 0 })
  assert.equal((await prisma.savingsPlan.findUnique({ where: { id: plan.id } }))?.balance, 600)
})

test('the skip reads the cycle day in WAT: 23:30 UTC is already the next day', async () => {
  const { plan, mandate } = await seedPlan({ maturityDate: new Date(now.getTime() + 60 * DAY), cadence: 'daily' })
  await covers(plan.id, '2031-03-11')
  const late = new Date('2031-03-10T23:30:00Z')
  assert.deepEqual(await runDueAutoDebits(prisma, late, { mandateIds: [mandate.id] }), { charged: 0, skipped: 1, failed: 0, pending: 0 })
  assert.equal(await prisma.autoDebitAttempt.count({ where: { savingsPlanId: plan.id } }), 0)
})

test('a weekly cycle inside a covered week slot is skipped though its date is not the slot key', async () => {
  // Slot starts Mar 3 and Mar 10 in WAT; the cycle falls on Mar 13.
  const { plan, mandate } = await seedPlan({ maturityDate: new Date(now.getTime() + 60 * DAY), startDate: new Date('2031-03-03T09:00:00Z') })
  await covers(plan.id, '2031-03-10')
  const cycle = new Date('2031-03-13T09:00:00Z')
  const scope = { mandateIds: [mandate.id] }
  assert.deepEqual(await runDueAutoDebits(prisma, cycle, scope), { charged: 0, skipped: 1, failed: 0, pending: 0 })
  assert.equal(await prisma.autoDebitAttempt.count({ where: { savingsPlanId: plan.id } }), 0)
  const m = await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: mandate.id } })
  assert.equal(m.nextRunAt.toISOString(), new Date(cycle.getTime() + 7 * DAY).toISOString())

  // The following week isn't covered: charged, so a covered week doesn't skip forever.
  assert.deepEqual(await runDueAutoDebits(prisma, m.nextRunAt, scope), { charged: 1, skipped: 0, failed: 0, pending: 0 })
})

test('coverage on a monthly plan never skips a charge', async () => {
  const { plan, mandate } = await seedPlan({ maturityDate: new Date(now.getTime() + 60 * DAY), cadence: 'monthly' })
  await covers(plan.id, '2031-03-10')
  assert.deepEqual(await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] }), { charged: 1, skipped: 0, failed: 0, pending: 0 })
})
