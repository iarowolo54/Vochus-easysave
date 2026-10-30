// Integration test: GET /api/customer/me returns freshly computed interest per plan.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { prisma } from '../src/lib/prisma'

const rid = Math.random().toString(36).slice(2, 8)
const DAY = 24 * 60 * 60 * 1000
let agentId = ''
const customerIds: string[] = []
const planIds: string[] = []

let currentToken = ''
const require_ = createRequire(import.meta.url)
const headersPath = require_.resolve('next/headers')
require_.cache[headersPath] = {
  id: headersPath, filename: headersPath, loaded: true, children: [], paths: [],
  exports: { cookies: async () => ({ get: (n: string) => (n === 'customer_token' && currentToken ? { name: n, value: currentToken } : undefined) }) },
} as unknown as NodeJS.Module

async function mk(source: 'self' | 'agent', n: number) {
  const c = await prisma.customer.create({
    data: { customerId: `CMI-${rid}-${n}`, agentId, firstName: 'C', lastName: 'X', phone: `08${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  const start = new Date(Date.now() - 40 * DAY)
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: start, maturityDate: new Date(Date.now() + 140 * DAY), balance: 1000, status: 'Active', source },
  })
  planIds.push(plan.id)
  await prisma.transaction.create({ data: { ref: `TX-${rid}-${n}`, agentId, customerId: c.id, planId: plan.id, type: 'saving', amount: 1000, status: 'Done', createdAt: start } })
  return c
}

async function me(c: { id: string; customerId: string }) {
  const { signCustomerToken } = await import('../src/lib/customer-auth')
  currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId })
  const { GET } = await import('../src/app/api/customer/me/route')
  const res = await GET()
  return { status: res.status, body: await res.json() }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `CMI-${rid}`, phone: `0796${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
})

after(async () => {
  await prisma.transaction.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('self plan: fresh interest (1000 at 12%/yr, one month = 10) on plan and plans[]', async () => {
  const c = await mk('self', 1)
  const { status, body } = await me(c)
  assert.equal(status, 200)
  assert.equal(body.plan.interest, 10)
  assert.equal(body.plans[0].interest, 10)
})

test('agent plan: interest is 0', async () => {
  const c = await mk('agent', 2)
  const { body } = await me(c)
  assert.equal(body.plan.interest, 0)
})
