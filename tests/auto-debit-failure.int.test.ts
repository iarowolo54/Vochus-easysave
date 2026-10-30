// Integration tests for recordAutoDebitFailure: retry counting, pause thresholds, idempotency.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { prisma } from '../src/lib/prisma'

// Stub the real senders (mail.ts / kudisms.ts) so no send happens and calls are observable.
const require_ = createRequire(import.meta.url)
const mailCalls: { to: string; subject: string; html: string }[] = []
const smsCalls: { to: string; body: string }[] = []
function stub(rel: string, exports: Record<string, unknown>) {
  const p = require_.resolve(rel)
  require_.cache[p] = { id: p, filename: p, loaded: true, children: [], paths: [], exports } as unknown as NodeJS.Module
}
let mailImpl: (a: { to: string; subject: string; html: string }) => Promise<void> = async (a) => { mailCalls.push(a) }
stub('../src/lib/mail', { sendMail: (a: { to: string; subject: string; html: string }) => mailImpl(a) })
stub('../src/lib/kudisms', { sendSMS: async (to: string, body: string) => { smsCalls.push({ to, body }); return { success: true } } })

const MAX_CONSECUTIVE_FAILURES = 3
const env = process.env as Record<string, string | undefined>
env.NODE_ENV = 'production' // senders are stubbed; the email path is production-gated
type Rec = typeof import('../src/lib/auto-debit-failure').recordAutoDebitFailure
const recordAutoDebitFailure: Rec = (...a) => require_('../src/lib/auto-debit-failure').recordAutoDebitFailure(...a)

const rid = Math.random().toString(36).slice(2, 8)
let agentId = ''
let customerId = ''
let emailCustomerId = ''
const EMAIL = `adf-${rid}@example.com`
const planIds: string[] = []
const mandateIds: string[] = []
const attemptIds: string[] = []
let n = 0

async function mk(cid: string = customerId) {
  const i = n++
  const plan = await prisma.savingsPlan.create({
    data: { customerId: cid, dailyAmount: 100, periodDays: 30, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 864e5), balance: 0, status: 'Active', source: 'self' },
  })
  planIds.push(plan.id)
  const m = await prisma.autoDebitMandate.create({
    data: { customerId: cid, savingsPlanId: plan.id, authorizationCode: 'AUTH_x', authSignature: 'SIG_x', authEmail: 'a@b.c', reusable: true, status: 'active', amountPerCycle: 100, nextRunAt: new Date() },
  })
  mandateIds.push(m.id)
  const mkAttempt = async (k: number) => {
    const a = await prisma.autoDebitAttempt.create({
      data: { mandateId: m.id, savingsPlanId: plan.id, reference: `ADF-${rid}-${i}-${k}`, cycleDate: new Date(), creditAmount: 100, grossCharged: 101, feeEstimate: 1, status: 'pending' },
    })
    attemptIds.push(a.id)
    return a.reference
  }
  return { m, mkAttempt }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `ADF-${rid}`, phone: `0795${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `ADF-C-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `0796${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
  const e = await prisma.customer.create({
    data: { customerId: `ADF-E-${rid}`, agentId, firstName: 'Ebo', lastName: 'X', phone: `0797${rid}`.padEnd(11, '0').slice(0, 11), email: EMAIL, address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  emailCustomerId = e.id
})

after(async () => {
  await prisma.autoDebitAttempt.deleteMany({ where: { id: { in: attemptIds } } })
  await prisma.autoDebitMandate.deleteMany({ where: { id: { in: mandateIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: [customerId, emailCustomerId] } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

const state = (id: string) => prisma.autoDebitMandate.findUniqueOrThrow({ where: { id } })

test('one insufficient-funds failure counts but does not pause', async () => {
  const { m, mkAttempt } = await mk()
  const ref = await mkAttempt(0)
  const r = await recordAutoDebitFailure(prisma, { reference: ref, gatewayResponse: 'Insufficient Funds' })
  assert.deepEqual(r, { paused: false })
  const s = await state(m.id)
  assert.equal(s.consecutiveFailures, 1)
  assert.equal(s.status, 'active')
  const a = await prisma.autoDebitAttempt.findUniqueOrThrow({ where: { reference: ref } })
  assert.equal(a.status, 'failed')
  assert.equal(a.gatewayResponse, 'Insufficient Funds')
})

test('pauses after MAX_CONSECUTIVE_FAILURES failures', async () => {
  assert.equal(MAX_CONSECUTIVE_FAILURES, 3)
  const { m, mkAttempt } = await mk()
  const results = []
  for (let k = 0; k < 3; k++) {
    results.push(await recordAutoDebitFailure(prisma, { reference: await mkAttempt(k), gatewayResponse: 'Insufficient Funds' }))
  }
  assert.deepEqual(results.map((r) => r.paused), [false, false, true])
  const s = await state(m.id)
  assert.equal(s.consecutiveFailures, 3)
  assert.equal(s.status, 'paused')
})

test('an expired card pauses immediately', async () => {
  const { m, mkAttempt } = await mk()
  const r = await recordAutoDebitFailure(prisma, { reference: await mkAttempt(0), gatewayResponse: 'Expired card' })
  assert.deepEqual(r, { paused: true })
  const s = await state(m.id)
  assert.equal(s.consecutiveFailures, 1)
  assert.equal(s.status, 'paused')
})

test('re-recording an already-failed reference does not increment again', async () => {
  const { m, mkAttempt } = await mk()
  const ref = await mkAttempt(0)
  await recordAutoDebitFailure(prisma, { reference: ref, gatewayResponse: 'Insufficient Funds' })
  const r = await recordAutoDebitFailure(prisma, { reference: ref, gatewayResponse: 'Insufficient Funds' })
  assert.deepEqual(r, { paused: false })
  assert.equal((await state(m.id)).consecutiveFailures, 1)
})

test('pausing a customer with an email sends one email, no SMS, without secrets', async () => {
  mailCalls.length = 0; smsCalls.length = 0
  const { mkAttempt } = await mk(emailCustomerId)
  const r = await recordAutoDebitFailure(prisma, { reference: await mkAttempt(0), gatewayResponse: 'Expired card' })
  assert.equal(r.paused, true)
  assert.equal(mailCalls.length, 1)
  assert.equal(mailCalls[0].to, EMAIL)
  assert.equal(smsCalls.length, 0)
  assert.doesNotMatch(mailCalls[0].html + mailCalls[0].subject, /AUTH_x|SIG_x|Expired/)
})

test('pausing a customer without an email sends one SMS, no email', async () => {
  mailCalls.length = 0; smsCalls.length = 0
  const { mkAttempt } = await mk(customerId)
  const r = await recordAutoDebitFailure(prisma, { reference: await mkAttempt(0), gatewayResponse: 'Expired card' })
  assert.equal(r.paused, true)
  assert.equal(smsCalls.length, 1)
  assert.equal(smsCalls[0].to.length > 0, true)
  assert.equal(mailCalls.length, 0)
  assert.doesNotMatch(smsCalls[0].body, /AUTH_x|SIG_x|Expired/)
})

test('a non-pausing failure sends nothing', async () => {
  mailCalls.length = 0; smsCalls.length = 0
  const { mkAttempt } = await mk(emailCustomerId)
  const r = await recordAutoDebitFailure(prisma, { reference: await mkAttempt(0), gatewayResponse: 'Insufficient Funds' })
  assert.equal(r.paused, false)
  assert.equal(mailCalls.length + smsCalls.length, 0)
})

test('a throwing sender never breaks recordAutoDebitFailure', async () => {
  mailImpl = async () => { throw new Error('smtp down') }
  const { m, mkAttempt } = await mk(emailCustomerId)
  const r = await recordAutoDebitFailure(prisma, { reference: await mkAttempt(0), gatewayResponse: 'Expired card' })
  assert.equal(r.paused, true)
  assert.equal((await state(m.id)).status, 'paused')
})

test('email is not sent outside production', async () => {
  mailCalls.length = 0
  mailImpl = async (a) => { mailCalls.push(a) }
  env.NODE_ENV = 'test'
  try {
    const { mkAttempt } = await mk(emailCustomerId)
    const r = await recordAutoDebitFailure(prisma, { reference: await mkAttempt(0), gatewayResponse: 'Expired card' })
    assert.equal(r.paused, true)
    assert.equal(mailCalls.length, 0)
  } finally {
    env.NODE_ENV = 'production'
  }
})
