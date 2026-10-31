// Admin inject-capital: validates amount, credits the Capital wallet, audits the real admin + reference.
// getServerSession is stubbed via a module-load hook (see savings-interest-admin.int.test.ts).
// The Capital wallet is shared, so assertions use deltas; audit rows are scoped by actorId (run id).
import { test, after, beforeEach } from 'node:test'
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
const { POST } = require('../src/app/api/admin/wallets/inject-capital/route') as typeof import('../src/app/api/admin/wallets/inject-capital/route')

const RUN = `test-inject-${Math.random().toString(36).slice(2, 10)}`
const NAME = `Admin ${RUN}`
const post = (body: unknown) => POST({ json: async () => body } as never)
const capital = async () => (await prisma.platformWallet.findUnique({ where: { type: 'Capital' } }))?.balance ?? 0
const audits = () => prisma.auditLog.findMany({ where: { actorId: RUN } })

beforeEach(() => {
  stub.getServerSession = async () => ({ user: { id: RUN, name: NAME, role: 'superadmin' } })
})

after(async () => {
  M._load = realLoad
  await prisma.auditLog.deleteMany({ where: { actorId: RUN } })
  await prisma.$disconnect()
})

test('credits Capital by amount and audits real admin + reference', async () => {
  const before = await capital()
  const res = await post({ amount: 1000.5, reference: `REF-${RUN}` })
  assert.equal(res.status, 200)
  assert.equal(Math.round(((await capital()) - before) * 100) / 100, 1000.5)
  const rows = await audits()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].actorId, RUN)
  assert.equal(rows[0].actorName, NAME)
  assert.equal(rows[0].actorType, 'admin')
  assert.ok(rows[0].details?.includes(`REF-${RUN}`))
  assert.ok(rows[0].details?.includes('1000.5'))
})

test('no reference still succeeds and audits "(no reference)"', async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: RUN } })
  const before = await capital()
  const res = await post({ amount: 10 })
  assert.equal(res.status, 200)
  assert.equal(Math.round(((await capital()) - before) * 100) / 100, 10)
  const rows = await audits()
  assert.equal(rows.length, 1)
  assert.ok(rows[0].details?.includes('(no reference)'))
})

test('bad amounts -> 400 with no wallet change or audit', async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: RUN } })
  const before = await capital()
  for (const amount of [0, -5, NaN, Infinity, 10_000_001, '500', null, undefined, 1.234]) {
    const res = await post({ amount, reference: 'x' })
    assert.equal(res.status, 400, `amount ${String(amount)}`)
  }
  assert.equal(await capital(), before)
  assert.equal((await audits()).length, 0)
})

test('non-superadmin is rejected without writing', async () => {
  stub.getServerSession = async () => ({ user: { id: RUN, role: 'agent' } })
  const before = await capital()
  assert.equal((await post({ amount: 5 })).status, 403)
  assert.equal(await capital(), before)
})
