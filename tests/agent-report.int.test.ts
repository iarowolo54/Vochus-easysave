// Superadmin per-agent CSV report. getServerSession is stubbed via a module-load hook (as in
// savings-interest-admin.int.test.ts). Rows are scoped by run id and deleted by id; we assert on
// our own agent's row only because the CSV covers every agent in the shared dev.db.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { prisma } from '../src/lib/prisma'

const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => null }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('../src/app/api/admin/reports/agents/route') as typeof import('../src/app/api/admin/reports/agents/route')

const DAY = 86_400_000
const rid = Math.random().toString().slice(2, 8)
const agentIds: string[] = []
const customerIds: string[] = []

after(async () => {
  M._load = realLoad
  await prisma.transaction.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.savingsPlan.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: { in: agentIds } } })
  await prisma.$disconnect()
})

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], f = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++ } else if (c === '"') q = false
      else f += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = '' }
    else f += c
  }
  if (f || row.length) { row.push(f); rows.push(row) }
  return rows
}

test('non-superadmin -> 403, anon -> 401', async () => {
  stub.getServerSession = async () => ({ user: { id: 'a1', role: 'agent' } })
  assert.equal((await GET()).status, 403)
  stub.getServerSession = async () => null
  assert.equal((await GET()).status, 401)
})

test('superadmin gets CSV with correct per-agent row', async () => {
  const agent = await prisma.agent.create({
    data: { agentId: `AR-${rid}`, phone: `0791${rid}`, name: `Rep, "The" ${rid}`, location: 'x', password: 'x', commissionBalance: 123.45 },
  })
  agentIds.push(agent.id)
  const mk = async (n: number, balance: number, depositAgeDays: number) => {
    const c = await prisma.customer.create({
      data: { customerId: `AR-${rid}-${n}`, agentId: agent.id, firstName: 'C', lastName: 'X', phone: `07${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
    })
    customerIds.push(c.id)
    const plan = await prisma.savingsPlan.create({
      data: { customerId: c.id, dailyAmount: 100, periodDays: 30, goal: 'x', startDate: new Date(), maturityDate: new Date(Date.now() + 30 * DAY), balance, status: 'Active' },
    })
    await prisma.transaction.create({
      data: { ref: `AR-${rid}-${n}`, agentId: agent.id, customerId: c.id, planId: plan.id, type: 'saving', amount: 100, status: 'Done', createdAt: new Date(Date.now() - depositAgeDays * DAY) },
    })
  }
  await mk(1, 1000, 0)
  await mk(2, 500, 4)

  stub.getServerSession = async () => ({ user: { id: 'adm', name: 'Admin', role: 'superadmin' } })
  const res = await GET()
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') ?? '', /^text\/csv/)
  assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="agent-report-\d{4}-\d{2}-\d{2}\.csv"$/)

  const rows = parseCsv(await res.text())
  assert.deepEqual(rows[0], ['agentId', 'name', 'customersCount', 'fundsUnderManagement', 'activePlansCount', 'commissionBalance', 'overdueSaversCount'])
  const mine = rows.find((r) => r[0] === agent.agentId)
  assert.ok(mine, 'agent row present')
  assert.equal(mine[1], agent.name)
  assert.equal(Number(mine[2]), 2)
  assert.equal(Number(mine[3]), 1500)
  assert.equal(Number(mine[4]), 2)
  assert.equal(Number(mine[5]), 123.45)
  assert.equal(Number(mine[6]), 1)
})
