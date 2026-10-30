// Integration test: POST /api/customer/auto-debit/init
process.env.PAYSTACK_SECRET_KEY = 'sk_test_autodebitinit'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'

const rid = Math.random().toString(36).slice(2, 8)
const DAY = 24 * 60 * 60 * 1000
let agentId = ''
const customerIds: string[] = []
const planIds: string[] = []
const refs: string[] = []

let currentToken = ''
const require_ = createRequire(import.meta.url)
const headersPath = require_.resolve('next/headers')
require_.cache[headersPath] = {
  id: headersPath, filename: headersPath, loaded: true, children: [], paths: [],
  exports: { cookies: async () => ({ get: (n: string) => (n === 'customer_token' && currentToken ? { name: n, value: currentToken } : undefined) }) },
} as unknown as NodeJS.Module

async function mk(source: 'self' | 'agent', n: number) {
  const c = await prisma.customer.create({
    data: { customerId: `ADI-${rid}-${n}`, agentId, firstName: 'C', lastName: 'X', phone: `08${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 180 * DAY), balance: 0, status: 'Active', source },
  })
  planIds.push(plan.id)
  return { c, plan }
}

async function call(c: { id: string; customerId: string } | null, planId: string) {
  if (c) {
    const { signCustomerToken } = await import('../src/lib/customer-auth')
    currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId })
  } else currentToken = ''
  const { POST } = await import('../src/app/api/customer/auto-debit/init/route')
  const res = await POST(new NextRequest('http://localhost/api/customer/auto-debit/init', { method: 'POST', body: JSON.stringify({ planId }) }))
  const body = await res.json()
  if (body.reference) refs.push(body.reference)
  return { status: res.status, body }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `ADI-${rid}`, phone: `0797${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
})

after(async () => {
  await prisma.autoDebitMandate.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.paymentIntent.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('self+Active plan: 200 with authorizationUrl, addenroll- ref, pending intent', async () => {
  const { c, plan } = await mk('self', 1)
  const { status, body } = await call(c, plan.id)
  assert.equal(status, 200)
  assert.ok(body.authorizationUrl)
  assert.ok(body.reference.startsWith('addenroll-'))
  const intent = await prisma.paymentIntent.findFirst({ where: { ref: body.reference } })
  assert.equal(intent?.status, 'Pending')
  assert.equal(intent?.amount, 50)
  assert.equal(intent?.planId, plan.id)
  assert.equal(intent?.customerId, c.id)
  assert.equal(intent?.actorType, 'customer')
})

test('agent plan: 400', async () => {
  const { c, plan } = await mk('agent', 2)
  assert.equal((await call(c, plan.id)).status, 400)
})

test('no session: 401', async () => {
  const { plan } = await mk('self', 3)
  assert.equal((await call(null, plan.id)).status, 401)
})

test("another customer's plan: 400 (not leaked)", async () => {
  const { plan } = await mk('self', 4)
  const { c: other } = await mk('self', 5)
  assert.equal((await call(other, plan.id)).status, 400)
})

test('existing active mandate: 409', async () => {
  const { c, plan } = await mk('self', 6)
  await prisma.autoDebitMandate.create({
    data: { customerId: c.id, savingsPlanId: plan.id, authorizationCode: 'x', authSignature: 'x', authEmail: 'a@b.c', status: 'active', amountPerCycle: 100, nextRunAt: new Date() },
  })
  assert.equal((await call(c, plan.id)).status, 409)
})
