// Integration tests: Paystack webhook credits auto-debit charge.success.
process.env.PAYSTACK_SECRET_KEY = 'sk_test_webhook'
process.env.PAYSTACK_WEBHOOK_SECRET = 'whsec_test_webhook'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { prisma } from '../src/lib/prisma'
import { POST } from '../src/app/api/paystack/webhook/route'

const rid = Math.random().toString(36).slice(2, 8)
let agentId = ''
let customerId = ''
let planId = ''
let mandateId = ''
let attemptId = ''
const reference = `autodebit-${rid}`

function sign(body: string, secret = process.env.PAYSTACK_WEBHOOK_SECRET as string) {
  return crypto.createHmac('sha512', secret).update(body).digest('hex')
}
function makeReq(body: string, sig: string) {
  return {
    text: async () => body,
    headers: new Headers({ 'x-paystack-signature': sig }),
  } as unknown as Parameters<typeof POST>[0]
}
const bodyFor = (ref: string, event = 'charge.success') =>
  JSON.stringify({ event, data: { reference: ref, status: 'success', amount: 71000, currency: 'NGN' } })

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `ADW-${rid}`, phone: `0796${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `ADW-C-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `0797${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
  const p = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 700, periodDays: 30, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * 864e5), balance: 100, status: 'Active', source: 'self' },
  })
  planId = p.id
  const m = await prisma.autoDebitMandate.create({
    data: { customerId, savingsPlanId: planId, authorizationCode: `AUTH_${rid}`, authSignature: 'sig', authEmail: 'a@b.c', status: 'active', amountPerCycle: 700, nextRunAt: new Date(), consecutiveFailures: 0 },
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

const balance = async () => (await prisma.savingsPlan.findUnique({ where: { id: planId } }))?.balance
const creditCount = () => prisma.transaction.count({ where: { planId, type: 'saving' } })

test('bad signature -> 401 and no credit', async () => {
  const body = bodyFor(reference)
  const res = await POST(makeReq(body, sign(body, 'wrong-secret')))
  assert.equal(res.status, 401)
  assert.equal(await creditCount(), 0)
  assert.equal(await balance(), 100)
})

test('non-autodebit reference is ignored', async () => {
  const body = bodyFor(`addenroll-${rid}`)
  const res = await POST(makeReq(body, sign(body)))
  assert.equal(res.status, 200)
  assert.equal(await creditCount(), 0)
})

test('valid charge.success credits once; replay does not double-credit', async () => {
  const body = bodyFor(reference)
  const res = await POST(makeReq(body, sign(body)))
  assert.equal(res.status, 200)
  assert.equal((await prisma.autoDebitAttempt.findUnique({ where: { id: attemptId } }))?.status, 'success')
  assert.equal(await balance(), 800)
  assert.equal(await creditCount(), 1)

  const res2 = await POST(makeReq(body, sign(body)))
  assert.equal(res2.status, 200)
  assert.equal(await balance(), 800)
  assert.equal(await creditCount(), 1)
})
