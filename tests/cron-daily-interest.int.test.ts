// Integration tests for GET /api/cron/daily: bearer auth (fail closed) + interest accrual pass.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { GET } from '../src/app/api/cron/daily/route'

const rid = Math.random().toString(36).slice(2, 8)
const SECRET = `cron-secret-${rid}`
const savedSecret = process.env.CRON_SECRET
let agentId = ''
let customerId = ''
const planIds: string[] = []

const call = (authorization?: string) =>
  GET(new Request('http://localhost/api/cron/daily', { headers: authorization ? { authorization } : {} }))

async function mkPlan(source: string) {
  const day = 86_400_000
  const start = new Date(Date.now() - 100 * day)
  const p = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 100, periodDays: 180, goal: 'x', startDate: start, maturityDate: new Date(Date.now() + 80 * day), balance: 0, status: 'Active', source },
  })
  planIds.push(p.id)
  await prisma.transaction.create({
    data: { ref: `TX-${rid}-${p.id}`, agentId, customerId, planId: p.id, type: 'saving', amount: 1000, status: 'Done', createdAt: start },
  })
  return p
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `CRN-${rid}`, phone: `0794${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const c = await prisma.customer.create({
    data: { customerId: `CRN-C-${rid}`, agentId, firstName: 'C', lastName: 'X', phone: `0795${rid}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerId = c.id
})

after(async () => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = savedSecret
  await prisma.transaction.deleteMany({ where: { planId: { in: planIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: customerId } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('unset or empty CRON_SECRET -> 401 (fail closed)', async () => {
  delete process.env.CRON_SECRET
  assert.equal((await call('Bearer anything')).status, 401)
  assert.equal((await call('Bearer ')).status, 401)
  process.env.CRON_SECRET = ''
  assert.equal((await call('Bearer ')).status, 401)
  assert.equal((await call('Bearer x')).status, 401)
})

test('missing, wrong and wrong-length bearer -> 401 without throwing', async () => {
  process.env.CRON_SECRET = SECRET
  assert.equal((await call()).status, 401)
  assert.equal((await call(`Bearer ${SECRET.replace(/.$/, 'X')}`)).status, 401)
  assert.equal((await call('Bearer short')).status, 401)
  assert.equal((await call(`Bearer ${SECRET}extra`)).status, 401)
  assert.equal((await call(SECRET)).status, 401)
})

test('correct bearer persists interest for self plans only', async () => {
  process.env.CRON_SECRET = SECRET
  const self = await mkPlan('self')
  const agent = await mkPlan('agent')
  const res = await call(`Bearer ${SECRET}`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { accrued: number }
  assert.ok(body.accrued >= 1)
  const s = await prisma.savingsPlan.findUniqueOrThrow({ where: { id: self.id } })
  const a = await prisma.savingsPlan.findUniqueOrThrow({ where: { id: agent.id } })
  // 3 completed monthly anniversaries on 1000 at a positive annual rate.
  assert.ok(s.interestAccrued > 0, `expected >0, got ${s.interestAccrued}`)
  assert.equal(a.interestAccrued, 0)
})
