// Integration tests for the auto-debit mandate lifecycle helpers (real prisma).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { createMandateFromAuthorization, dueMandates, pauseMandate, cancelMandate } from '../src/lib/auto-debit'
import type { PaystackAuthorization } from '../src/lib/paystack'

const rid = Math.random().toString(36).slice(2, 8)
let agentId = ''
let customerId = ''
const planIds: string[] = []

const FUTURE = new Date(Date.now() + 90 * 86_400_000)
const auth = (over: Partial<PaystackAuthorization> = {}): PaystackAuthorization => ({
  authorization_code: `AUTH_${rid}`, signature: `SIG_${rid}`, reusable: true,
  last4: '4081', card_type: 'visa', bank: 'TEST BANK', exp_month: '12', exp_year: '2030', channel: 'card', ...over,
})

async function mkPlan(source: string, over: { status?: string; maturityDate?: Date } = {}) {
  const p = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 500, periodDays: 90, goal: 'x', startDate: new Date(), maturityDate: over.maturityDate ?? FUTURE, balance: 0, status: over.status ?? 'Active', source, cadence: 'daily' },
  })
  planIds.push(p.id)
  return p
}
const input = (p: { id: string; source: string; cadence: string; dailyAmount: number }, a = auth()) => ({
  customerId, plan: { id: p.id, source: p.source, cadence: p.cadence, dailyAmount: p.dailyAmount }, email: `c-${rid}@example.com`, authorization: a,
})

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `ADM-${rid}`, phone: `0794${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `ADM-C-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `0795${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
})

after(async () => {
  await prisma.autoDebitMandate.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('self + reusable creates an active mandate with masked fields', async () => {
  const p = await mkPlan('self')
  const before = Date.now()
  const r = await createMandateFromAuthorization(prisma, input(p))
  assert.ok('id' in r)
  const m = await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: (r as { id: string }).id } })
  assert.equal(m.status, 'active')
  assert.equal(m.authorizationCode, `AUTH_${rid}`)
  assert.equal(m.authSignature, `SIG_${rid}`)
  assert.equal(m.authEmail, `c-${rid}@example.com`)
  assert.equal(m.reusable, true)
  assert.equal(m.last4, '4081')
  assert.equal(m.cardType, 'visa')
  assert.equal(m.bankName, 'TEST BANK')
  assert.equal(m.expMonth, '12')
  assert.equal(m.expYear, '2030')
  assert.equal(m.amountPerCycle, 500)
  // daily plan -> first run one day out (D7: daily is daily)
  assert.ok(m.nextRunAt.getTime() > before + 23 * 3_600_000)
  assert.ok(m.nextRunAt.getTime() < before + 2 * 86_400_000)
  assert.ok(!JSON.stringify(m).match(/\b\d{13,19}\b/), 'no raw PAN')
})

test('agent plan -> not_self', async () => {
  const p = await mkPlan('agent')
  assert.deepEqual(await createMandateFromAuthorization(prisma, input(p)), { error: 'not_self' })
})

test('non-reusable card -> not_reusable', async () => {
  const p = await mkPlan('self')
  assert.deepEqual(await createMandateFromAuthorization(prisma, input(p, auth({ reusable: false }))), { error: 'not_reusable' })
})

test('second call for same plan -> exists', async () => {
  const p = await mkPlan('self')
  assert.ok('id' in (await createMandateFromAuthorization(prisma, input(p))))
  assert.deepEqual(await createMandateFromAuthorization(prisma, input(p)), { error: 'exists' })
})

test('dueMandates returns only active, due, pre-maturity mandates of Active plans; pause/cancel', async () => {
  const now = new Date()
  const past = new Date(now.getTime() - 3600_000)
  const mk = async (plan: { id: string }, status: string, nextRunAt: Date) =>
    prisma.autoDebitMandate.create({
      data: { customerId, savingsPlanId: plan.id, authorizationCode: 'A', authSignature: 'S', authEmail: 'e@x.com', reusable: true, status, amountPerCycle: 500, nextRunAt },
    })
  const good = await mk(await mkPlan('self'), 'active', past)
  const paused = await mk(await mkPlan('self'), 'paused', past)
  const notDue = await mk(await mkPlan('self'), 'active', new Date(now.getTime() + 3600_000))
  const inactivePlan = await mk(await mkPlan('self', { status: 'Completed' }), 'active', past)
  const matured = await mk(await mkPlan('self', { maturityDate: past }), 'active', past)

  const ids = (await dueMandates(prisma, now)).map((m) => m.id)
  assert.ok(ids.includes(good.id))
  for (const x of [paused, notDue, inactivePlan, matured]) assert.ok(!ids.includes(x.id))
  const row = (await dueMandates(prisma, now)).find((m) => m.id === good.id)
  assert.equal(row?.savingsPlan.status, 'Active')

  await pauseMandate(prisma, good.id)
  assert.equal((await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: good.id } })).status, 'paused')
  await cancelMandate(prisma, good.id)
  assert.equal((await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: good.id } })).status, 'cancelled')
})
