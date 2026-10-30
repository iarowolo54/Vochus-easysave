// Integration test: POST /api/customer/redeem freezes accrued interest on the request.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import { money } from '../src/lib/wallet-guard'

const rid = Math.random().toString(36).slice(2, 8)
const DAY = 24 * 60 * 60 * 1000
let agentId = ''
const customerIds: string[] = []
const planIds: string[] = []

// The route reads the session via next/headers cookies(), which only works inside a Next
// request scope. Stub that module with a cookie jar holding a real signed customer_token.
let currentToken = ''
const require_ = createRequire(import.meta.url)
const headersPath = require_.resolve('next/headers')
require_.cache[headersPath] = {
  id: headersPath, filename: headersPath, loaded: true, children: [], paths: [],
  exports: { cookies: async () => ({ get: (n: string) => (n === 'customer_token' && currentToken ? { name: n, value: currentToken } : undefined) }) },
} as unknown as NodeJS.Module

async function mk(source: 'self' | 'agent', n: number) {
  const c = await prisma.customer.create({
    data: { customerId: `RIF-${rid}-${n}`, agentId, firstName: 'C', lastName: 'X', phone: `08${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  // Started 40 days ago: exactly one monthly anniversary has elapsed.
  const start = new Date(Date.now() - 40 * DAY)
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: start, maturityDate: new Date(Date.now() + 140 * DAY), balance: 1000, status: 'Active', source },
  })
  planIds.push(plan.id)
  await prisma.transaction.create({ data: { ref: `TX-${rid}-${n}`, agentId, customerId: c.id, planId: plan.id, type: 'saving', amount: 1000, status: 'Done', createdAt: start } })
  return { c, plan }
}

async function call(c: { id: string; customerId: string }) {
  const { signCustomerToken } = await import('../src/lib/customer-auth')
  currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId })
  const { POST } = await import('../src/app/api/customer/redeem/route')
  const req = new NextRequest('http://localhost/api/customer/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'test' }),
  })
  const res = await POST(req)
  return { status: res.status, body: await res.json() }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `RIF-${rid}`, phone: `0795${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
})

after(async () => {
  await prisma.earlyRedemption.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.transaction.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

// 1000 deposited at start, one completed month at the 12% baseline: 1000 * 12% / 12 = 10.
test('self plan: interest 10 frozen on the request; payout = balance + interest', async () => {
  const { c, plan } = await mk('self', 1)
  const { status, body } = await call(c)
  assert.equal(status, 200)
  const row = await prisma.earlyRedemption.findUniqueOrThrow({ where: { ref: body.ref } })
  assert.equal(row.interestAmount, 10)
  assert.equal(body.interest, 10)
  assert.equal(body.deduction, 0)
  assert.equal(row.netPayout, money(plan.balance + row.interestAmount))
  assert.equal(body.netPayout, 1010)
})

test('agent plan: no interest; payout = balance - deduction (unchanged)', async () => {
  const { c, plan } = await mk('agent', 2)
  const { status, body } = await call(c)
  assert.equal(status, 200)
  const row = await prisma.earlyRedemption.findUniqueOrThrow({ where: { ref: body.ref } })
  assert.equal(row.interestAmount, 0)
  assert.equal(body.interest, 0)
  assert.equal(row.netPayout, money(plan.balance - row.penalty))
  assert.equal(body.netPayout, money(plan.balance - body.deduction))
})
