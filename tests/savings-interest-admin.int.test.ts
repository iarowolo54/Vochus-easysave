// Superadmin savings-rate API. getServerSession cannot be minted in-test, so it is stubbed on
// the next-auth module (admin-guard reads it live) to simulate superadmin / agent / anon actors.
// Rows created here are tagged via createdBy and deleted by tag; the shared table is never wiped.
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { prisma } from '../src/lib/prisma'

// next-auth's exports are getter-only, so intercept the module load instead of patching it.
// The route is imported AFTER the hook is installed so admin-guard binds to the stub.
const stub = { getServerSession: async (..._a: unknown[]): Promise<unknown> => null }
const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown }
const realLoad = M._load
M._load = function (req: string, ...rest: unknown[]) {
  const mod = realLoad.call(this, req, ...rest) as Record<string, unknown>
  if (req === 'next-auth') return new Proxy(mod, { get: (t, k) => (k === 'getServerSession' ? stub.getServerSession : t[k as string]) })
  return mod
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET, POST } = require('../src/app/api/admin/savings-interest/route') as typeof import('../src/app/api/admin/savings-interest/route')

const TAG = `test-admin-${Math.random().toString(36).slice(2, 10)}`
const ADMIN_ID = TAG

function actAs(user: { id: string; role?: string } | null) {
  stub.getServerSession = async () => (user ? { user: { name: 'Test Admin', ...user } } : null)
}
const post = (body: unknown) => POST({ json: async () => body } as never)
const countAll = () => prisma.savingsInterestRate.count()

beforeEach(() => actAs({ id: ADMIN_ID, role: 'superadmin' }))

after(async () => {
  M._load = realLoad
  await prisma.savingsInterestRate.deleteMany({ where: { createdBy: ADMIN_ID } })
  await prisma.auditLog.deleteMany({ where: { actorId: ADMIN_ID } })
  await prisma.$disconnect()
})

test('GET as superadmin returns current + history', async () => {
  const res = await GET()
  assert.equal(res.status, 200)
  const body = (await res.json()) as { current: number; history: { effectiveFrom: string; annualRate: number }[] }
  assert.equal(typeof body.current, 'number')
  assert.ok(Array.isArray(body.history))
  if (body.history.length === 0) assert.equal(body.current, 12)
})

test('GET as anonymous -> 401, agent-role -> 403', async () => {
  actAs(null)
  assert.equal((await GET()).status, 401)
  actAs({ id: 'a1', role: 'agent' })
  assert.equal((await GET()).status, 403)
})

test('POST valid rate appends and becomes current', async () => {
  const res = await post({ annualRate: 7.5 })
  assert.equal(res.status, 200)
  const body = (await res.json()) as { current: number }
  assert.equal(body.current, 7.5)
  const row = await prisma.savingsInterestRate.findFirst({ where: { createdBy: ADMIN_ID } })
  assert.equal(row?.annualRate, 7.5)
  const got = (await (await GET()).json()) as { current: number; history: { annualRate: number }[] }
  assert.equal(got.current, 7.5)
  assert.ok(got.history.some((h) => h.annualRate === 7.5))
})

test('POST as non-superadmin -> 403 and nothing appended', async () => {
  actAs({ id: 'a1', role: 'agent' })
  const before = await countAll()
  assert.equal((await post({ annualRate: 9 })).status, 403)
  actAs(null)
  assert.equal((await post({ annualRate: 9 })).status, 401)
  assert.equal(await countAll(), before)
})

test('POST invalid rate -> 400 and nothing appended', async () => {
  const before = await countAll()
  for (const bad of [{ annualRate: -1 }, { annualRate: NaN }, { annualRate: Infinity }, { annualRate: '5' }, {}, null]) {
    assert.equal((await post(bad)).status, 400, JSON.stringify(bad))
  }
  assert.equal(await countAll(), before)
})
