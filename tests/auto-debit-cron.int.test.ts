// Integration tests for the auto-debit cron passes (test-mode Paystack, real prisma).
process.env.PAYSTACK_SECRET_KEY = 'sk_test_cron'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { recordAutoDebitFailure } from '../src/lib/auto-debit-failure'
import { reconcileAbandonedEnrollments, runDueAutoDebits, reconcileProcessingAttempts } from '../src/lib/auto-debit-run'

const rid = Math.random().toString(36).slice(2, 8)
const now = new Date('2031-03-10T09:00:00Z')
const DAY = 864e5
let agentId = ''
let customerId = ''
const planIds: string[] = []
const mandateIds: string[] = []
const redemptionIds: string[] = []

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
  await prisma.earlyRedemption.deleteMany({ where: { id: { in: redemptionIds } } })
  await prisma.customerPayment.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.paymentIntent.deleteMany({ where: { planId: { in: planIds } } })
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

const deposit = (planId: string, amount: number, createdAt: Date, ref = `dep-${rid}-${Math.random().toString(36).slice(2, 10)}`) =>
  prisma.transaction.create({ data: { ref, agentId, customerId, planId, type: 'saving', amount, status: 'Done', createdAt } })

const inPlan = () => ({ maturityDate: new Date(now.getTime() + 60 * DAY), cadence: 'daily' })

test('plain deposits of the exact amount skip the charge and advance', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  await deposit(plan.id, 500, new Date(now.getTime() - 3600e3))
  assert.deepEqual(await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] }), { charged: 0, skipped: 1, failed: 0, pending: 0 })
  assert.equal(await prisma.autoDebitAttempt.count({ where: { savingsPlanId: plan.id } }), 0)
  assert.ok((await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: mandate.id } })).nextRunAt.getTime() > now.getTime())
})

test('plain deposits one naira under are charged as normal', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  await deposit(plan.id, 499, new Date(now.getTime() - 3600e3))
  assert.deepEqual(await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] }), { charged: 1, skipped: 0, failed: 0, pending: 0 })
})

test('several small deposits add up to a skip', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  await deposit(plan.id, 200, new Date(now.getTime() - 3 * 3600e3))
  await deposit(plan.id, 300, new Date(now.getTime() - 3600e3))
  assert.deepEqual(await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] }), { charged: 0, skipped: 1, failed: 0, pending: 0 })
})

test('weekly: a full week of plain deposits skips; a partial week is charged', async () => {
  // Slot starts Mar 3 and Mar 10; the cycle falls on Mar 13. A week here is 500 x 7.
  const week = { maturityDate: new Date(now.getTime() + 60 * DAY), startDate: new Date('2031-03-03T09:00:00Z') }
  const cycle = new Date('2031-03-13T09:00:00Z')
  const full = await seedPlan(week)
  await deposit(full.plan.id, 3000, new Date('2031-03-10T09:00:00Z'))
  await deposit(full.plan.id, 500, new Date('2031-03-12T09:00:00Z'))
  assert.deepEqual(await runDueAutoDebits(prisma, cycle, { mandateIds: [full.mandate.id] }), { charged: 0, skipped: 1, failed: 0, pending: 0 })

  const part = await seedPlan(week)
  await deposit(part.plan.id, 3499, new Date('2031-03-10T09:00:00Z'))
  assert.deepEqual(await runDueAutoDebits(prisma, cycle, { mandateIds: [part.mandate.id] }), { charged: 1, skipped: 0, failed: 0, pending: 0 })
})

test('weekly: an earlier auto-debit credit below the week amount does not make the cycle skip itself', async () => {
  const { plan, mandate } = await seedPlan({ maturityDate: new Date(now.getTime() + 60 * DAY), startDate: new Date('2031-03-03T09:00:00Z') })
  await deposit(plan.id, 500, new Date('2031-03-10T09:00:00Z'), `autodebit-${plan.id}-20310310`)
  assert.deepEqual(await runDueAutoDebits(prisma, new Date('2031-03-13T09:00:00Z'), { mandateIds: [mandate.id] }), { charged: 1, skipped: 0, failed: 0, pending: 0 })
})

test('weekly: a week already fully paid, by whatever route, is not charged again', async () => {
  const { plan, mandate } = await seedPlan({ maturityDate: new Date(now.getTime() + 60 * DAY), startDate: new Date('2031-03-03T09:00:00Z') })
  await deposit(plan.id, 3500, new Date('2031-03-10T09:00:00Z'), `autodebit-${plan.id}-20310310`)
  assert.deepEqual(await runDueAutoDebits(prisma, new Date('2031-03-13T09:00:00Z'), { mandateIds: [mandate.id] }), { charged: 0, skipped: 1, failed: 0, pending: 0 })
})

test('a coverage payment stamped today does not fund today', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  const ref = `bulk-${rid}-${plan.id}`
  await deposit(plan.id, 500, new Date(now.getTime() - 3600e3), ref)
  await prisma.planDayCoverage.create({ data: { savingsPlanId: plan.id, coversKey: '2031-03-11', ref } })
  assert.deepEqual(await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] }), { charged: 1, skipped: 0, failed: 0, pending: 0 })
})

for (const status of ['Pending', 'TokenValidated', 'AgentApproved', 'AwaitingOTP', 'Finalizing']) {
  test(`an open redemption (${status}) skips and advances with no charge`, async () => {
    const { plan, mandate } = await seedPlan(inPlan())
    const r = await prisma.earlyRedemption.create({
      data: { ref: `er-${rid}-${status}`, savingsPlanId: plan.id, balance: 100, status, reason: 'x', netPayout: 100 },
    })
    redemptionIds.push(r.id)
    assert.deepEqual(await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] }), { charged: 0, skipped: 1, failed: 0, pending: 0 })
    assert.equal(await prisma.autoDebitAttempt.count({ where: { savingsPlanId: plan.id } }), 0)
    assert.ok((await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: mandate.id } })).nextRunAt.getTime() > now.getTime())
  })
}

test('a Pending redemption whose code ran out does not stop auto-debit, which nothing else would ever clear', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  const r = await prisma.earlyRedemption.create({
    data: { ref: `er-${rid}-expired`, savingsPlanId: plan.id, balance: 100, status: 'Pending', reason: 'x', netPayout: 100, tokenExpiry: new Date(now.getTime() - 1000) },
  })
  redemptionIds.push(r.id)
  assert.deepEqual(await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] }), { charged: 1, skipped: 0, failed: 0, pending: 0 })
})

test('a Pending redemption with a live code does stop it', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  const r = await prisma.earlyRedemption.create({
    data: { ref: `er-${rid}-live`, savingsPlanId: plan.id, balance: 100, status: 'Pending', reason: 'x', netPayout: 100, tokenExpiry: new Date(now.getTime() + 60_000) },
  })
  redemptionIds.push(r.id)
  assert.deepEqual(await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] }), { charged: 0, skipped: 1, failed: 0, pending: 0 })
})

test('a future-start plan is not charged before it starts, then is once it has', async () => {
  const { plan, mandate } = await seedPlan({ maturityDate: new Date(now.getTime() + 60 * DAY), cadence: 'daily', startDate: new Date(now.getTime() + 2 * DAY) })
  const scope = { mandateIds: [mandate.id] }
  assert.deepEqual(await runDueAutoDebits(prisma, now, scope), { charged: 0, skipped: 1, failed: 0, pending: 0 })
  assert.equal(await prisma.autoDebitAttempt.count({ where: { savingsPlanId: plan.id } }), 0)
  assert.deepEqual(await runDueAutoDebits(prisma, new Date(now.getTime() + 3 * DAY), scope), { charged: 1, skipped: 0, failed: 0, pending: 0 })
})

test('the maturity day is outside the plan even before the maturity instant', async () => {
  // Started Mar 1 at 12:00 for 9 days: the last slot is Mar 9. Mar 10 at 09:00 is still before maturity at 12:00.
  const { plan, mandate } = await seedPlan({ maturityDate: new Date('2031-03-10T12:00:00Z'), cadence: 'daily', startDate: new Date('2031-03-01T12:00:00Z') })
  await prisma.savingsPlan.update({ where: { id: plan.id }, data: { periodDays: 9 } })
  assert.deepEqual(await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] }), { charged: 0, skipped: 1, failed: 0, pending: 0 })
  assert.equal(await prisma.autoDebitAttempt.count({ where: { savingsPlanId: plan.id } }), 0)
})

async function holdIntent(planId: string, key: string, createdAt: Date) {
  const ref = `hold-${rid}-${Math.random().toString(36).slice(2, 10)}`
  await prisma.paymentIntent.create({ data: { ref, actorType: 'customer', customerId, planId, amount: 500, coversKeys: JSON.stringify([key]), createdAt } })
  return ref
}

test('a fresh checkout holding the cycle day defers it: no attempt, not advanced, and logged', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  await holdIntent(plan.id, '2031-03-10', new Date(now.getTime() - 10 * 60 * 1000))
  assert.deepEqual(await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] }), { charged: 0, skipped: 1, failed: 0, pending: 0 })
  assert.equal(await prisma.autoDebitAttempt.count({ where: { savingsPlanId: plan.id } }), 0)
  const m = await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: mandate.id } })
  assert.equal(m.nextRunAt.toISOString(), mandate.nextRunAt.toISOString(), 'not advanced')
  assert.ok(await prisma.auditLog.findFirst({ where: { action: 'auto_debit_deferred', entityId: plan.id } }))
})

test('deferring cannot stick: once the hold goes stale the same mandate is charged', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  await holdIntent(plan.id, '2031-03-10', new Date(now.getTime() - 10 * 60 * 1000))
  const scope = { mandateIds: [mandate.id] }
  await runDueAutoDebits(prisma, now, scope)
  const later = new Date(now.getTime() + 61 * 60 * 1000)
  assert.deepEqual(await runDueAutoDebits(prisma, later, scope), { charged: 1, skipped: 0, failed: 0, pending: 0 })
})

test('a checkout holding a different day does not defer this one', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  await holdIntent(plan.id, '2031-03-12', new Date(now.getTime() - 10 * 60 * 1000))
  assert.deepEqual(await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] }), { charged: 1, skipped: 0, failed: 0, pending: 0 })
})

test('a payment settling just before the charge stops it: re-read after the attempt is created', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  // Stands in for a webhook landing between the first check and the charge.
  const racing = new Proxy(prisma, {
    get(target, key) {
      if (key !== 'autoDebitAttempt') return Reflect.get(target, key)
      return new Proxy(target.autoDebitAttempt, {
        get(att, k) {
          if (k !== 'create') return Reflect.get(att, k)
          return async (args: Parameters<typeof att.create>[0]) => {
            const row = await att.create(args)
            await covers(plan.id, '2031-03-10')
            return row
          }
        },
      })
    },
  })
  assert.deepEqual(await runDueAutoDebits(racing, now, { mandateIds: [mandate.id] }), { charged: 0, skipped: 1, failed: 0, pending: 0 })
  const [attempt] = await prisma.autoDebitAttempt.findMany({ where: { savingsPlanId: plan.id } })
  assert.equal(attempt.status, 'skipped')
  assert.equal(await prisma.transaction.count({ where: { planId: plan.id } }), 0)
  assert.ok((await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: mandate.id } })).nextRunAt.getTime() > now.getTime())
})

// ── Charges that never reached Paystack ──
function withLiveKey<T>(respond: (url: string) => { body: unknown; status?: number }, run: () => Promise<T>): Promise<T> {
  const [key, realFetch] = [process.env.PAYSTACK_SECRET_KEY, global.fetch]
  process.env.PAYSTACK_SECRET_KEY = 'sk_live_not_real'
  global.fetch = (async (url: string | URL | Request) => {
    const { body, status } = respond(String(url))
    return new Response(JSON.stringify(body), { status: status ?? 200 })
  }) as typeof fetch
  return run().finally(() => { process.env.PAYSTACK_SECRET_KEY = key; global.fetch = realFetch })
}

const staleAttempt = (mandateId: string, savingsPlanId: string, reference: string, overrides: Record<string, unknown> = {}) =>
  prisma.autoDebitAttempt.create({
    data: { mandateId, savingsPlanId, reference, cycleDate: now, creditAmount: 500, grossCharged: 508, feeEstimate: 8, status: 'processing', createdAt: new Date(now.getTime() - 3 * 3600e3), ...overrides },
  })

test('a charge Paystack refuses outright is a counted failure, not stuck processing', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  const r = await withLiveKey(() => ({ body: { status: false, message: 'Invalid authorization code' }, status: 400 }), () => runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] }))
  assert.equal(r.failed, 1)
  assert.equal((await prisma.autoDebitAttempt.findFirstOrThrow({ where: { savingsPlanId: plan.id } })).status, 'failed')
  assert.ok((await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: mandate.id } })).consecutiveFailures >= 1)
})

test('a timeout leaves the attempt processing for reconcile', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  const [key, realFetch] = [process.env.PAYSTACK_SECRET_KEY, global.fetch]
  process.env.PAYSTACK_SECRET_KEY = 'sk_live_not_real'
  global.fetch = (async () => { throw new Error('timed out') }) as typeof fetch
  try {
    await runDueAutoDebits(prisma, now, { mandateIds: [mandate.id] })
  } finally {
    process.env.PAYSTACK_SECRET_KEY = key
    global.fetch = realFetch
  }
  const at = await prisma.autoDebitAttempt.findFirstOrThrow({ where: { savingsPlanId: plan.id } })
  assert.equal(at.status, 'processing')
  assert.equal((await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: mandate.id } })).consecutiveFailures, 0)
})

test('reconcile fails an old attempt Paystack has never heard of', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  const reference = `autodebit-${plan.id}-unknown`
  await staleAttempt(mandate.id, plan.id, reference)
  const r = await withLiveKey(() => ({ body: { status: false, message: 'Transaction reference not found' }, status: 400 }), () => reconcileProcessingAttempts(prisma, now, undefined, { mandateIds: [mandate.id] }))
  assert.deepEqual(r, { settled: 0, failed: 1 })
  assert.equal((await prisma.autoDebitAttempt.findUniqueOrThrow({ where: { reference } })).status, 'failed')
})

test('reconcile leaves it processing on any other error', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  const reference = `autodebit-${plan.id}-other`
  await staleAttempt(mandate.id, plan.id, reference)
  await withLiveKey(() => ({ body: { status: false, message: 'Invalid key' }, status: 401 }), () => reconcileProcessingAttempts(prisma, now, undefined, { mandateIds: [mandate.id] }))
  assert.equal((await prisma.autoDebitAttempt.findUniqueOrThrow({ where: { reference } })).status, 'processing')
})

for (const [label, data] of [
  ['too little money', { status: 'success', amount: 100, currency: 'NGN' }],
  ['another currency', { status: 'success', amount: 50800, currency: 'USD' }],
] as const) {
  test(`reconcile sends ${label} to review, uncredited`, async () => {
    const { plan, mandate } = await seedPlan(inPlan())
    const reference = `autodebit-${plan.id}-mismatch`
    await staleAttempt(mandate.id, plan.id, reference)
    const r = await withLiveKey(() => ({ body: { status: true, data } }), () => reconcileProcessingAttempts(prisma, now, undefined, { mandateIds: [mandate.id] }))
    assert.deepEqual(r, { settled: 0, failed: 0 })
    assert.equal((await prisma.autoDebitAttempt.findUniqueOrThrow({ where: { reference } })).status, 'review')
    assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: plan.id } })).balance, 100)
  })
}

test('a day whose charge fails is flagged if a payment gave way to that charge', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  const reference = `autodebit-${plan.id}-yield`
  await staleAttempt(mandate.id, plan.id, reference)
  const ref = `yielded-${rid}-${plan.id}`
  await prisma.paymentIntent.create({ data: { ref, actorType: 'customer', customerId, planId: plan.id, amount: 500, coversKeys: JSON.stringify(['2031-03-10']), status: 'Done' } })
  await recordAutoDebitFailure(prisma, { reference, gatewayResponse: 'Declined' })
  const row = await prisma.auditLog.findFirst({ where: { action: 'payment_yielded_to_failed_charge', details: { contains: ref } } })
  assert.ok(row)
})

test('a covered day is not flagged when a charge on it fails', async () => {
  const { plan, mandate } = await seedPlan(inPlan())
  const reference = `autodebit-${plan.id}-covered`
  await staleAttempt(mandate.id, plan.id, reference)
  const ref = `coveredpay-${rid}-${plan.id}`
  await prisma.paymentIntent.create({ data: { ref, actorType: 'customer', customerId, planId: plan.id, amount: 500, coversKeys: JSON.stringify(['2031-03-10']), status: 'Done' } })
  await prisma.planDayCoverage.create({ data: { savingsPlanId: plan.id, coversKey: '2031-03-10', ref } })
  await recordAutoDebitFailure(prisma, { reference, gatewayResponse: 'Declined' })
  assert.equal(await prisma.auditLog.count({ where: { action: 'payment_yielded_to_failed_charge', details: { contains: ref } } }), 0)
})

// ── Enrollment where the customer never came back ──
test('an old first payment the customer never returned for is saved, with no mandate, and only once', async () => {
  const { plan } = await seedPlan(inPlan())
  await prisma.autoDebitMandate.deleteMany({ where: { savingsPlanId: plan.id } })
  const ref = `addenroll-${plan.id}-${rid}`
  await prisma.paymentIntent.create({ data: { ref, actorType: 'customer', customerId, planId: plan.id, amount: 50, createdAt: new Date(Date.now() - 3 * 3600e3) } })
  assert.equal(await reconcileAbandonedEnrollments(prisma), 1)
  assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: plan.id } })).balance, 150)
  assert.equal(await prisma.autoDebitMandate.count({ where: { savingsPlanId: plan.id } }), 0)
  assert.equal(await reconcileAbandonedEnrollments(prisma), 0)
  assert.equal(await prisma.transaction.count({ where: { ref } }), 1)
})

test('a recent first payment is left for the customer to come back to', async () => {
  const { plan } = await seedPlan(inPlan())
  const ref = `addenroll-${plan.id}-${rid}-new`
  await prisma.paymentIntent.create({ data: { ref, actorType: 'customer', customerId, planId: plan.id, amount: 50 } })
  await reconcileAbandonedEnrollments(prisma)
  assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { ref } })).status, 'Pending')
})
