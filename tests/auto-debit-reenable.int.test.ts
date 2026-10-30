// Integration test: re-enrolling a paused/cancelled mandate reactivates the SAME row
// and auto-debit actually resumes (real prisma, test-mode Paystack).
process.env.PAYSTACK_SECRET_KEY = 'sk_test_reenable'
process.env.NEXTAUTH_SECRET = 'test'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { createMandateFromAuthorization, dueMandates, cancelMandate, pauseMandate } from '../src/lib/auto-debit'
import { runDueAutoDebits } from '../src/lib/auto-debit-run'
import type { PaystackAuthorization } from '../src/lib/paystack'

const rid = Math.random().toString(36).slice(2, 8)
const DAY = 864e5
let agentId = ''
let customerId = ''
const planIds: string[] = []
const mandateIds: string[] = []

const FUTURE = new Date(Date.now() + 90 * DAY)
const auth = (over: Partial<PaystackAuthorization> = {}): PaystackAuthorization => ({
  authorization_code: `AUTH_${rid}`, signature: `SIG_${rid}`, reusable: true,
  last4: '4081', card_type: 'visa', bank: 'TEST BANK', exp_month: '12', exp_year: '2030', channel: 'card', ...over,
})

async function mkPlan(over: { status?: string; maturityDate?: Date; cadence?: string } = {}) {
  const p = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 500, periodDays: 90, goal: 'x', startDate: new Date(), maturityDate: over.maturityDate ?? FUTURE, balance: 100, status: over.status ?? 'Active', source: 'self', cadence: over.cadence ?? 'weekly' },
  })
  planIds.push(p.id)
  return p
}
const input = (p: { id: string; source: string; cadence: string; dailyAmount: number }, a = auth()) => ({
  customerId, plan: { id: p.id, source: p.source, cadence: p.cadence, dailyAmount: p.dailyAmount }, email: `c-${rid}@example.com`, authorization: a,
})

async function seedMandate(planId: string, status: string) {
  const m = await prisma.autoDebitMandate.create({
    data: { customerId, savingsPlanId: planId, authorizationCode: 'OLD_AUTH', authSignature: 'OLD_SIG', authEmail: 'old@x.com', reusable: true, last4: '0000', cardType: 'verve', bankName: 'OLD BANK', expMonth: '01', expYear: '2025', status, amountPerCycle: 500, nextRunAt: new Date(Date.now() + 365 * DAY), consecutiveFailures: 3 },
  })
  mandateIds.push(m.id)
  return m
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `ADRE-${rid}`, phone: `0793${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `ADRE-C-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `0798${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
})

after(async () => {
  await prisma.transaction.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.autoDebitAttempt.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.autoDebitMandate.deleteMany({ where: { id: { in: mandateIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('cancelled mandate re-enrolled -> SAME row reactivated, fields refreshed, and auto-debit resumes', async () => {
  const p = await mkPlan()
  const first = await createMandateFromAuthorization(prisma, input(p, auth({ authorization_code: 'OLD_AUTH', signature: 'OLD_SIG', last4: '0000' })))
  assert.ok('id' in first)
  const mandateId = (first as { id: string }).id
  mandateIds.push(mandateId)

  // Drive it to cancelled (the D2 cancel path).
  await cancelMandate(prisma, mandateId)
  assert.equal((await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: mandateId } })).status, 'cancelled')

  // Re-enroll with a (possibly-new) reusable card.
  const before = Date.now()
  const again = await createMandateFromAuthorization(prisma, input(p, auth({
    authorization_code: `NEW_AUTH_${rid}`, signature: `NEW_SIG_${rid}`, last4: '1111', card_type: 'mastercard', bank: 'NEW BANK', exp_month: '09', exp_year: '2031',
  })))
  assert.ok('id' in again, 'reactivation returns an id (success)')
  assert.equal((again as { id: string }).id, mandateId, 'SAME row is reused (unique savingsPlanId preserved)')

  const m = await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: mandateId } })
  assert.equal(m.status, 'active')
  assert.equal(m.consecutiveFailures, 0)
  assert.equal(m.authorizationCode, `NEW_AUTH_${rid}`)
  assert.equal(m.authSignature, `NEW_SIG_${rid}`)
  assert.equal(m.authEmail, `c-${rid}@example.com`)
  assert.equal(m.last4, '1111')
  assert.equal(m.cardType, 'mastercard')
  assert.equal(m.bankName, 'NEW BANK')
  assert.equal(m.expMonth, '09')
  assert.equal(m.expYear, '2031')
  assert.equal(m.amountPerCycle, 500)
  assert.ok(m.nextRunAt.getTime() > before, 'fresh nextRunAt scheduled')

  // dueMandates now returns it once past nextRunAt, and a run actually charges it.
  const runAt = new Date(m.nextRunAt.getTime() + 1000)
  const due = (await dueMandates(prisma, runAt)).filter((x) => x.id === mandateId)
  assert.equal(due.length, 1, 'reactivated mandate is due')
  const r = await runDueAutoDebits(prisma, runAt, { mandateIds: [mandateId] })
  assert.equal(r.charged, 1, 'auto-debit resumed and charged')
  assert.equal((await prisma.savingsPlan.findUniqueOrThrow({ where: { id: p.id } })).balance, 600)
})

test('paused mandate re-enrolled -> reactivated to active', async () => {
  const p = await mkPlan()
  const m = await seedMandate(p.id, 'active')
  await pauseMandate(prisma, m.id)
  assert.equal((await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: m.id } })).status, 'paused')

  const again = await createMandateFromAuthorization(prisma, input(p))
  assert.ok('id' in again)
  assert.equal((again as { id: string }).id, m.id)
  const reloaded = await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: m.id } })
  assert.equal(reloaded.status, 'active')
  assert.equal(reloaded.consecutiveFailures, 0)
})

test('already-active mandate -> exists (genuine duplicate)', async () => {
  const p = await mkPlan()
  const m = await seedMandate(p.id, 'active')
  assert.deepEqual(await createMandateFromAuthorization(prisma, input(p)), { error: 'exists' })
  // untouched
  assert.equal((await prisma.autoDebitMandate.findUniqueOrThrow({ where: { id: m.id } })).authorizationCode, 'OLD_AUTH')
})
