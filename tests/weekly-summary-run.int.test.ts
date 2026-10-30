// Integration tests for sendWeeklySummaries: recipients, channel choice, dedupe, failure isolation.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { prisma } from '../src/lib/prisma'

const require_ = createRequire(import.meta.url)
const mailCalls: { to: string; subject: string; html: string }[] = []
const smsCalls: { to: string; body: string }[] = []
function stub(rel: string, exports: Record<string, unknown>) {
  const p = require_.resolve(rel)
  require_.cache[p] = { id: p, filename: p, loaded: true, children: [], paths: [], exports } as unknown as NodeJS.Module
}
let mailImpl: (a: { to: string; subject: string; html: string }) => Promise<void> = async (a) => { mailCalls.push(a) }
stub('../src/lib/mail', { sendMail: (a: { to: string; subject: string; html: string }) => mailImpl(a) })
let smsImpl: (to: string) => { success: boolean } = () => ({ success: true })
stub('../src/lib/kudisms', { sendSMS: async (to: string, body: string) => { smsCalls.push({ to, body }); return smsImpl(to) } })

async function withNodeEnv<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const env = process.env as Record<string, string | undefined>
  const prev = env.NODE_ENV
  env.NODE_ENV = value
  try { return await fn() } finally {
    if (prev === undefined) delete env.NODE_ENV
    else env.NODE_ENV = prev
  }
}

type Run = typeof import('../src/lib/weekly-summary-run').sendWeeklySummaries
const sendWeeklySummaries: Run = (...a) => require_('../src/lib/weekly-summary-run').sendWeeklySummaries(...a)

const rid = Math.random().toString(36).slice(2, 8)
const NOW = new Date('2026-10-30T09:00:00Z')
let agentId = ''
const ids: Record<'a' | 'b' | 'c' | 'd' | 'e', string> = { a: '', b: '', c: '', d: '', e: '' }
const planIds: string[] = []
const txIds: string[] = []
const EMAIL_A = `ws-a-${rid}@example.com`
const PHONE_B = `0791${rid}`.padEnd(11, '0').slice(0, 11)

async function mkCustomer(key: keyof typeof ids, o: { email?: string; phone: string; status?: string }) {
  const c = await prisma.customer.create({
    data: {
      customerId: `WS-${key}-${rid}`, agentId, firstName: key.toUpperCase(), lastName: 'X', phone: o.phone,
      email: o.email, address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800', status: o.status ?? 'Active',
    },
  })
  ids[key] = c.id
}
async function mkPlan(customerId: string, status: string) {
  const p = await prisma.savingsPlan.create({
    data: { customerId, dailyAmount: 100, periodDays: 30, goal: 'x', startDate: new Date(), maturityDate: new Date(NOW.getTime() + 30 * 864e5), balance: 500, status, source: 'self' },
  })
  planIds.push(p.id)
}

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `WS-${rid}`, phone: `0792${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  // Customers with no email and no phone: phone is required in schema, so use empty string.
  await mkCustomer('a', { email: EMAIL_A, phone: `0793${rid}`.padEnd(11, '0').slice(0, 11) })
  await mkCustomer('b', { phone: PHONE_B })
  await mkCustomer('c', { phone: '' })
  await mkCustomer('d', { email: `ws-d-${rid}@example.com`, phone: `0794${rid}`.padEnd(11, '0').slice(0, 11), status: 'Inactive' })
  await mkCustomer('e', { email: `ws-e-${rid}@example.com`, phone: `0795${rid}`.padEnd(11, '0').slice(0, 11) })
  for (const k of ['a', 'b', 'c', 'd'] as const) await mkPlan(ids[k], 'Active')
  await mkPlan(ids.e, 'Redeemed')
  const t = await prisma.transaction.create({
    data: { ref: `WS-TX-${rid}`, agentId, customerId: ids.a, type: 'saving', amount: 300, status: 'Done', createdAt: new Date(NOW.getTime() - 2 * 864e5) },
  })
  txIds.push(t.id)
})

after(async () => {
  const all = Object.values(ids)
  await prisma.notificationLog.deleteMany({ where: { customerId: { in: all } } })
  await prisma.transaction.deleteMany({ where: { id: { in: txIds } } })
  await prisma.savingsPlan.deleteMany({ where: { id: { in: planIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: all } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('sends by channel, dedupes, isolates failures', () => withNodeEnv('production', async () => {
  mailImpl = async (a) => { mailCalls.push(a) }
  const opts = { customerIds: Object.values(ids) }
  const r1 = await sendWeeklySummaries(prisma, NOW, opts)
  assert.equal(mailCalls.length, 1)
  assert.equal(mailCalls[0].to, EMAIL_A)
  assert.equal(smsCalls.length, 1)
  assert.equal(smsCalls[0].to, PHONE_B)
  assert.equal(r1.emailed, 1)
  assert.equal(r1.smsed, 1)
  assert.equal(r1.failed, 0)
  const logs = await prisma.notificationLog.findMany({ where: { customerId: { in: Object.values(ids) }, kind: 'weekly_summary' } })
  const logged = new Set(logs.map((l) => l.customerId))
  assert.ok(logged.has(ids.a) && logged.has(ids.b))
  assert.ok(!logged.has(ids.d) && !logged.has(ids.e))

  // second run same week sends nothing
  const r2 = await sendWeeklySummaries(prisma, NOW, opts)
  assert.equal(mailCalls.length, 1)
  assert.equal(smsCalls.length, 1)
  assert.equal(r2.emailed + r2.smsed, 0)
  assert.ok(r2.skipped >= 2)

  // next week: a throwing sendMail does not stop the SMS customer
  const next = new Date(NOW.getTime() + 7 * 864e5)
  mailImpl = async () => { throw new Error('boom') }
  const r3 = await sendWeeklySummaries(prisma, next, opts)
  assert.equal(r3.failed, 1)
  assert.equal(r3.smsed, 1)
  assert.equal(smsCalls.length, 2)
}))

test('email is gated on NODE_ENV: skipped outside production but still counted', async () => {
  mailImpl = async (a) => { mailCalls.push(a) }
  const opts = { customerIds: Object.values(ids) }
  const before = mailCalls.length
  const wk = new Date(NOW.getTime() + 14 * 864e5)
  const r = await withNodeEnv('development', () => sendWeeklySummaries(prisma, wk, opts))
  assert.equal(mailCalls.length, before, 'sendMail must not be called outside production')
  assert.equal(r.emailed, 1)
})

test('email is sent when NODE_ENV is production', async () => {
  mailImpl = async (a) => { mailCalls.push(a) }
  const opts = { customerIds: Object.values(ids) }
  const before = mailCalls.length
  const wk = new Date(NOW.getTime() + 21 * 864e5)
  const r = await withNodeEnv('production', () => sendWeeklySummaries(prisma, wk, opts))
  assert.equal(mailCalls.length, before + 1)
  assert.equal(mailCalls[before].to, EMAIL_A)
  assert.equal(r.emailed, 1)
})

test('a failed SMS is counted as failed, not smsed', async () => {
  const opts = { customerIds: Object.values(ids) }
  const wk = new Date(NOW.getTime() + 28 * 864e5)
  smsImpl = () => ({ success: false })
  try {
    const r = await withNodeEnv('development', () => sendWeeklySummaries(prisma, wk, opts))
    assert.equal(r.smsed, 0)
    assert.equal(r.failed, 1)
  } finally {
    smsImpl = () => ({ success: true })
  }
})
