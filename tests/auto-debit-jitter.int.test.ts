// A cron that fires a few seconds off must neither skip a day nor charge early, and the weekly/monthly amount
// stays one day until the owner turns the full-cycle switch on (test-mode Paystack, real prisma).
process.env.PAYSTACK_SECRET_KEY = 'sk_test_jitter'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { runDueAutoDebits } from '../src/lib/auto-debit-run'

const rid = Math.random().toString(36).slice(2, 8)
const DAY = 864e5
const SWITCH = 'AUTO_DEBIT_FULL_CYCLE_AMOUNT'
let agentId = ''
let customerId = ''
const planIds: string[] = []

async function seed(cadence: string, dueAt: Date) {
  const plan = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 100, periodDays: 90, cadence, goal: 'x', startDate: new Date(dueAt.getTime() - 7 * DAY), maturityDate: new Date(dueAt.getTime() + 60 * DAY), balance: 0, status: 'Active', source: 'self' },
  })
  planIds.push(plan.id)
  const mandate = await prisma.autoDebitMandate.create({
    data: { customerId, savingsPlanId: plan.id, authorizationCode: `AUTH_${rid}`, authSignature: 'sig', authEmail: 'a@b.c', status: 'active', amountPerCycle: 100, nextRunAt: dueAt },
  })
  return { plan, mandate }
}
const scope = (m: { id: string }) => ({ mandateIds: [m.id] })
const nextRun = async (id: string) => (await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id } })).nextRunAt

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `JIT-${rid}`, phone: `0798${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `JIT-C-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `0799${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
})

after(async () => {
  delete process.env[SWITCH]
  await prisma.autoDebitAttempt.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.autoDebitMandate.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.customerPayment.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.transaction.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.paymentIntent.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('a daily mandate is charged on consecutive mornings even when the cron lands seconds before the run that set the boundary', async () => {
  const due = new Date('2031-05-01T06:00:00Z')
  const { mandate } = await seed('daily', due)
  // Day 1: the cron fires 3 seconds late.
  assert.deepEqual(await runDueAutoDebits(prisma, new Date(due.getTime() + 3000), scope(mandate)), { charged: 1, skipped: 0, failed: 0, pending: 0 })
  assert.equal((await nextRun(mandate.id)).toISOString(), new Date(due.getTime() + DAY).toISOString(), 'the boundary stays on the hour')
  // Day 2: the cron fires only 1 second after 06:00, earlier than day 1's run did. It used to find nothing due.
  assert.deepEqual(await runDueAutoDebits(prisma, new Date(due.getTime() + DAY + 1000), scope(mandate)), { charged: 1, skipped: 0, failed: 0, pending: 0 })
  assert.equal((await nextRun(mandate.id)).toISOString(), new Date(due.getTime() + 2 * DAY).toISOString())
})

test('a cron early by a second charges nothing and the mandate keeps its boundary', async () => {
  const due = new Date('2031-06-01T06:00:00Z')
  const { mandate } = await seed('daily', due)
  assert.deepEqual(await runDueAutoDebits(prisma, new Date(due.getTime() - 1000), scope(mandate)), { charged: 0, skipped: 0, failed: 0, pending: 0 })
  assert.equal((await nextRun(mandate.id)).toISOString(), due.toISOString())
})

test('after a missed day the mandate charges once and moves past now, not once per missed day', async () => {
  const due = new Date('2031-07-01T06:00:00Z')
  const { mandate, plan } = await seed('daily', due)
  const late = new Date(due.getTime() + 3 * DAY + 5000)
  assert.deepEqual(await runDueAutoDebits(prisma, late, scope(mandate)), { charged: 1, skipped: 0, failed: 0, pending: 0 })
  assert.equal((await nextRun(mandate.id)).toISOString(), new Date(due.getTime() + 4 * DAY).toISOString())
  assert.equal(await prisma.autoDebitAttempt.count({ where: { savingsPlanId: plan.id } }), 1)
})

test('weekly charges one day while the switch is off, and a full week once it is on', async () => {
  delete process.env[SWITCH]
  const off = await seed('weekly', new Date('2031-08-01T06:00:00Z'))
  await runDueAutoDebits(prisma, new Date('2031-08-01T06:00:02Z'), scope(off.mandate))
  assert.equal((await prisma.autoDebitAttempt.findFirstOrThrow({ where: { savingsPlanId: off.plan.id } })).creditAmount, 100)

  process.env[SWITCH] = '1'
  const on = await seed('weekly', new Date('2031-08-01T06:00:00Z'))
  await runDueAutoDebits(prisma, new Date('2031-08-01T06:00:02Z'), scope(on.mandate))
  const attempt = await prisma.autoDebitAttempt.findFirstOrThrow({ where: { savingsPlanId: on.plan.id } })
  assert.equal(attempt.creditAmount, 700)
  assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: on.plan.id } })).balance, 700, 'the plan is credited the full week')
})
