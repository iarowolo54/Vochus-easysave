// Integration test: GET /api/customer/me surfaces mid-payout redemptions (handoff #30).
// AwaitingOTP and Finalizing must count as pending (so the home tracker stays and Save/New plan
// stay locked); Approved (paid) must NOT.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { prisma } from '../src/lib/prisma'

const rid = Math.random().toString(36).slice(2, 8)
const DAY = 24 * 60 * 60 * 1000
let agentId = ''
const customerIds: string[] = []
const planIds: string[] = []
const redemptionIds: string[] = []

let currentToken = ''
const require_ = createRequire(import.meta.url)
const headersPath = require_.resolve('next/headers')
require_.cache[headersPath] = {
  id: headersPath, filename: headersPath, loaded: true, children: [], paths: [],
  exports: { cookies: async () => ({ get: (n: string) => (n === 'customer_token' && currentToken ? { name: n, value: currentToken } : undefined) }) },
} as unknown as NodeJS.Module

async function mkWithRedemption(n: number, status: string) {
  const c = await prisma.customer.create({
    data: { customerId: `CMP-${rid}-${n}`, agentId, firstName: 'C', lastName: 'X', phone: `08${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: new Date(Date.now() - 10 * DAY), maturityDate: new Date(Date.now() + 170 * DAY), balance: 1000, status: 'Active', source: 'self' },
  })
  planIds.push(plan.id)
  const r = await prisma.earlyRedemption.create({
    data: { ref: `CMP-${rid}-${n}`, savingsPlanId: plan.id, type: 'early', reason: 'x', status, balance: 1000, penalty: 0, netPayout: 1000, token: `h-${rid}-${n}`, tokenExpiry: new Date(Date.now() + DAY) },
  })
  redemptionIds.push(r.id)
  return { c, plan }
}

async function me(c: { id: string; customerId: string }) {
  const { signCustomerToken } = await import('../src/lib/customer-auth')
  currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId })
  const { GET } = await import('../src/app/api/customer/me/route')
  const res = await GET()
  return { status: res.status, body: await res.json() }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `CMP-${rid}`, phone: `0796${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
})

after(async () => {
  await prisma.earlyRedemption.deleteMany({ where: { id: { in: redemptionIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

for (const status of ['AwaitingOTP', 'Finalizing', 'Pending', 'TokenValidated', 'AgentApproved']) {
  test(`${status} redemption is surfaced as pending on /me`, async () => {
    const { c } = await mkWithRedemption(status === 'AwaitingOTP' ? 1 : status === 'Finalizing' ? 2 : status === 'Pending' ? 3 : status === 'TokenValidated' ? 4 : 5, status)
    const { status: code, body } = await me(c)
    assert.equal(code, 200)
    assert.ok(body.pendingRedemption, `pendingRedemption should be set for ${status}`)
    assert.equal(body.pendingRedemption.status, status)
  })
}

test('Approved (paid) redemption is NOT surfaced as pending', async () => {
  const { c, body } = await (async () => {
    const r = await mkWithRedemption(6, 'Approved')
    const res = await me(r.c)
    return { c: r.c, body: res.body }
  })()
  void c
  assert.equal(body.pendingRedemption, null)
})
