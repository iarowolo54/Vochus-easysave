// Integration test: GET /api/customer/auto-debit and POST /api/customer/auto-debit/cancel
process.env.PAYSTACK_SECRET_KEY = 'sk_test_autodebitcancel'
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

let currentToken = ''
const require_ = createRequire(import.meta.url)
const headersPath = require_.resolve('next/headers')
require_.cache[headersPath] = {
  id: headersPath, filename: headersPath, loaded: true, children: [], paths: [],
  exports: { cookies: async () => ({ get: (n: string) => (n === 'customer_token' && currentToken ? { name: n, value: currentToken } : undefined) }) },
} as unknown as NodeJS.Module

type Cust = { id: string; customerId: string }

async function mk(n: number, withMandate: boolean) {
  const c = await prisma.customer.create({
    data: { customerId: `ADC-${rid}-${n}`, agentId, firstName: 'C', lastName: 'X', phone: `08${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  const plan = await prisma.savingsPlan.create({
    data: { customerId: c.id, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 180 * DAY), balance: 0, status: 'Active', source: 'self' },
  })
  planIds.push(plan.id)
  if (withMandate) {
    await prisma.autoDebitMandate.create({
      data: { customerId: c.id, savingsPlanId: plan.id, authorizationCode: 'AUTH_secret_xyz', authSignature: 'SIG_secret', authEmail: 'a@b.c', status: 'active', amountPerCycle: 100, nextRunAt: new Date(Date.now() + DAY), last4: '4242', bankName: 'Test Bank' },
    })
  }
  return { c, plan }
}

async function login(c: Cust | null) {
  if (c) {
    const { signCustomerToken } = await import('../src/lib/customer-auth')
    currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId })
  } else currentToken = ''
}

async function get(c: Cust | null, planId: string) {
  await login(c)
  const { GET } = await import('../src/app/api/customer/auto-debit/route')
  const res = await GET(new NextRequest(`http://localhost/api/customer/auto-debit?planId=${planId}`))
  return { status: res.status, text: await res.text() }
}

async function cancel(c: Cust | null, planId: string) {
  await login(c)
  const { POST } = await import('../src/app/api/customer/auto-debit/cancel/route')
  const res = await POST(new NextRequest('http://localhost/api/customer/auto-debit/cancel', { method: 'POST', body: JSON.stringify({ planId }) }))
  return { status: res.status, body: await res.json() }
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `ADC-${rid}`, phone: `0798${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
})

after(async () => {
  await prisma.auditLog.deleteMany({ where: { entity: 'AutoDebitMandate', details: { contains: rid } } }).catch(() => {})
  await prisma.autoDebitMandate.deleteMany({ where: { savingsPlanId: { in: planIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('GET enrolled plan: masked status, no secrets', async () => {
  const { c, plan } = await mk(1, true)
  const r = await get(c, plan.id)
  assert.equal(r.status, 200)
  const body = JSON.parse(r.text)
  assert.equal(body.status, 'active')
  assert.equal(body.amountPerCycle, 100)
  assert.ok(body.nextRunAt)
  assert.equal(body.last4, '4242')
  assert.equal(body.bankName, 'Test Bank')
  assert.ok(!('authorizationCode' in body) && !('authSignature' in body) && !('authEmail' in body))
  assert.ok(!r.text.includes('AUTH_secret_xyz') && !r.text.includes('SIG_secret'))
})

test('GET plan without mandate: status none', async () => {
  const { c, plan } = await mk(2, false)
  const r = await get(c, plan.id)
  assert.equal(r.status, 200)
  assert.deepEqual(JSON.parse(r.text), { status: 'none' })
})

test('cancel: mandate cancelled and GET then shows cancelled', async () => {
  const { c, plan } = await mk(3, true)
  const r = await cancel(c, plan.id)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { status: 'cancelled' })
  const m = await prisma.autoDebitMandate.findUnique({ where: { savingsPlanId: plan.id } })
  assert.equal(m?.status, 'cancelled')
  const g = await get(c, plan.id)
  assert.equal(JSON.parse(g.text).status, 'cancelled')
})

test("foreign plan: GET and cancel 404, mandate untouched", async () => {
  const { plan } = await mk(4, true)
  const { c: other } = await mk(5, false)
  assert.equal((await get(other, plan.id)).status, 404)
  assert.equal((await cancel(other, plan.id)).status, 404)
  const m = await prisma.autoDebitMandate.findUnique({ where: { savingsPlanId: plan.id } })
  assert.equal(m?.status, 'active')
})

test('cancel own plan with no mandate: 404', async () => {
  const { c, plan } = await mk(6, false)
  assert.equal((await cancel(c, plan.id)).status, 404)
})

test('no session: 401', async () => {
  const { plan } = await mk(7, true)
  assert.equal((await get(null, plan.id)).status, 401)
  assert.equal((await cancel(null, plan.id)).status, 401)
})
