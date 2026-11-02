// Integration test: GET /api/customer/auto-debit reports the next date that will really be charged.
process.env.PAYSTACK_SECRET_KEY = 'sk_test_nextpayment'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import { watKey } from '../src/lib/savings-card'

const rid = Math.random().toString(36).slice(2, 8)
const DAY = 864e5
let agentId = ''
let customer = { id: '', customerId: '' }
const planIds: string[] = []

let currentToken = ''
const require_ = createRequire(import.meta.url)
const headersPath = require_.resolve('next/headers')
require_.cache[headersPath] = {
  id: headersPath, filename: headersPath, loaded: true, children: [], paths: [],
  exports: { cookies: async () => ({ get: (n: string) => (n === 'customer_token' && currentToken ? { name: n, value: currentToken } : undefined) }) },
} as unknown as NodeJS.Module

async function seed(days: number, status = 'active') {
  const plan = await prisma.savingsPlan.create({
    data: { customerId: customer.id, dailyAmount: 100, periodDays: days, cadence: 'daily', goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + days * DAY), balance: 0, status: 'Active', source: 'self' },
  })
  planIds.push(plan.id)
  const run = new Date(Date.now() + DAY)
  await prisma.autoDebitMandate.create({
    data: { customerId: customer.id, savingsPlanId: plan.id, authorizationCode: `AUTH_${rid}`, authSignature: 'sig', authEmail: 'a@b.c', status, amountPerCycle: 100, nextRunAt: run },
  })
  return { plan, run }
}

async function get(planId: string) {
  const { signCustomerToken } = await import('../src/lib/customer-auth')
  currentToken = await signCustomerToken({ id: customer.id, customerId: customer.customerId, name: 'C X', agentId })
  const { GET } = await import('../src/app/api/customer/auto-debit/route')
  const res = await GET(new NextRequest(`http://localhost/api/customer/auto-debit?planId=${planId}`))
  return { status: res.status, body: await res.json() }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `ADN-${rid}`, phone: `0794${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `ADN-C-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `0793${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customer = { id: c.id, customerId: c.customerId }
})

after(async () => {
  await prisma.planDayCoverage.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.autoDebitMandate.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: customer.id } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('next payment skips covered days', async () => {
  const { plan, run } = await seed(30)
  await prisma.planDayCoverage.create({ data: { savingsPlanId: plan.id, coversKey: watKey(run), ref: `r-${rid}-1` } })
  const { status, body } = await get(plan.id)
  assert.equal(status, 200)
  assert.equal(body.nextPaymentAt, new Date(run.getTime() + DAY).toISOString())
})

test('next payment is null when every remaining day is covered', async () => {
  const { plan } = await seed(4)
  for (let i = 0; i <= 5; i++) {
    await prisma.planDayCoverage.create({ data: { savingsPlanId: plan.id, coversKey: watKey(new Date(Date.now() + i * DAY)), ref: `r-${rid}-a${i}` } })
  }
  assert.equal((await get(plan.id)).body.nextPaymentAt, null)
})

test('a cancelled mandate has no next payment', async () => {
  const { plan } = await seed(30, 'cancelled')
  assert.equal((await get(plan.id)).body.nextPaymentAt, null)
})

test('no mandate still reports none', async () => {
  const plan = await prisma.savingsPlan.create({
    data: { customerId: customer.id, dailyAmount: 100, periodDays: 30, cadence: 'daily', goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * DAY), balance: 0, status: 'Active', source: 'self' },
  })
  planIds.push(plan.id)
  assert.deepEqual((await get(plan.id)).body, { status: 'none' })
})
