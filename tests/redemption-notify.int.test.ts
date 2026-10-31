// Integration tests for notifySuperAdminsRedemptionPending: gating, recipients, content, never throws.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { prisma } from '../src/lib/prisma'

const require_ = createRequire(import.meta.url)
type Mail = { to: string; subject: string; html: string }
const mailCalls: Mail[] = []
let mailImpl: (a: Mail) => Promise<void> = async (a) => { mailCalls.push(a) }
const mailPath = require_.resolve('../src/lib/mail')
require_.cache[mailPath] = {
  id: mailPath, filename: mailPath, loaded: true, children: [], paths: [],
  exports: { sendMail: (a: Mail) => mailImpl(a) },
} as unknown as NodeJS.Module

type Fn = typeof import('../src/lib/redemption-notify').notifySuperAdminsRedemptionPending
const notify: Fn = (...a) => require_('../src/lib/redemption-notify').notifySuperAdminsRedemptionPending(...a)

const env = process.env as Record<string, string | undefined>
const rid = Math.random().toString(36).slice(2, 8)
const WITH_EMAIL = `rn-${rid}@example.com`
const adminIds: string[] = []
const input = { customerName: `Ada Test${rid}`, amountNaira: 12345.5, planGoal: 'School fees', ref: `RED-${rid}` }
const mine = () => mailCalls.filter((m) => m.to === WITH_EMAIL)

async function withEnv<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const prev = env.NODE_ENV
  env.NODE_ENV = value
  try { return await fn() } finally { env.NODE_ENV = prev }
}

before(async () => {
  const a = await prisma.superAdmin.create({ data: { email: WITH_EMAIL, password: 'x', name: 'Has Email' } })
  const b = await prisma.superAdmin.create({ data: { email: '', password: 'x', name: 'No Email' } })
  adminIds.push(a.id, b.id)
})

after(async () => {
  await prisma.superAdmin.deleteMany({ where: { id: { in: adminIds } } })
  await prisma.$disconnect()
})

test('production: emails each admin that has an email, with amount and ref, no secrets', async () => {
  mailCalls.length = 0
  await withEnv('production', () => notify(prisma, input))
  assert.equal(mine().length, 1)
  assert.equal(mailCalls.filter((m) => !m.to).length, 0)
  const m = mine()[0]
  assert.match(m.subject, /Redemption awaiting approval/)
  assert.ok(m.html.includes('12,345.50'), 'amount')
  assert.ok(m.html.includes(input.ref), 'ref')
  assert.ok(m.html.includes(input.customerName), 'customer')
  assert.ok(m.html.includes('School fees'), 'goal')
  assert.ok(!/password|token|otp|secret/i.test(m.html))
})

test('non-production: nothing is sent', async () => {
  mailCalls.length = 0
  await withEnv('test', () => notify(prisma, input))
  assert.equal(mailCalls.length, 0)
})

test('a throwing sendMail does not throw out', async () => {
  const prev = mailImpl
  mailImpl = async () => { throw new Error('smtp down') }
  try {
    await withEnv('production', async () => { await notify(prisma, input) })
  } finally { mailImpl = prev }
})

test('a failing client does not throw out', async () => {
  const broken = { superAdmin: { findMany: async () => { throw new Error('db') } } } as unknown as Parameters<Fn>[0]
  await withEnv('production', async () => { await notify(broken, input) })
})

test('wiring: the agent-approval route fires the notification at the AgentApproved transition, fire-and-forget', async () => {
  const { readFileSync } = await import('node:fs')
  const f = 'src/app/api/agent/redemption/[id]/route.ts'
  const src = readFileSync(f, 'utf8')
  const approve = src.indexOf(`status: 'AgentApproved'`)
  const call = src.indexOf('notifySuperAdminsRedemptionPending(prisma')
  assert.ok(approve > -1, `${f}: must set AgentApproved`)
  assert.ok(call > approve, `${f}: notify must follow the AgentApproved update`)
  assert.match(src.slice(call, call + 400), /\.catch\(\(\) => \{\}\)/, `${f}: must be fire-and-forget`)
})

test('wiring: the two redemption-creating routes no longer notify at creation', async () => {
  const { readFileSync } = await import('node:fs')
  for (const f of ['src/app/api/customer/redeem/route.ts', 'src/app/api/transactions/redemption/request/route.ts']) {
    const src = readFileSync(f, 'utf8')
    assert.equal(src.indexOf('notifySuperAdminsRedemptionPending'), -1, `${f}: must not notify at creation — the email fires at the admin-approval stage`)
  }
})
