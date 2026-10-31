// Admin loan interest-rates API: maxAmount + per-term enabled toggle. Real prisma; rows use a
// per-run unique durationDays and are deleted by id. getServerSession is stubbed via module hook.
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
const { GET, POST } = require('../src/app/api/admin/interest-rates/route') as typeof import('../src/app/api/admin/interest-rates/route')

const ADMIN_ID = `test-ir-${Math.random().toString(36).slice(2, 10)}`
const BASE = 50000 + Math.floor(Math.random() * 40000)
let n = 0
const nextDays = () => BASE + n++
const created: number[] = []
const post = (body: unknown) => POST({ json: async () => body } as never)
type Rate = { durationDays: number; rate: number; maxAmount: number | null; enabled: boolean }
const getRate = async (d: number) => {
  const body = (await (await GET()).json()) as { rates: Rate[] }
  return body.rates.find((r) => r.durationDays === d)
}

beforeEach(() => { stub.getServerSession = async () => ({ user: { id: ADMIN_ID, name: 'T', role: 'superadmin' } }) })

after(async () => {
  M._load = realLoad
  await prisma.interestRate.deleteMany({ where: { durationDays: { in: created } } })
  await prisma.auditLog.deleteMany({ where: { actorId: ADMIN_ID } })
  await prisma.$disconnect()
})

test('POST with maxAmount + enabled:false persists; GET returns them', async () => {
  const d = nextDays(); created.push(d)
  const res = await post({ rates: [{ durationDays: d, label: 'T', rate: 5, maxAmount: 250000, enabled: false }] })
  assert.equal(res.status, 200)
  const r = await getRate(d)
  assert.equal(r?.maxAmount, 250000)
  assert.equal(r?.enabled, false)
  assert.equal(r?.rate, 5)
})

test('POST without maxAmount leaves null and enabled defaults true', async () => {
  const d = nextDays(); created.push(d)
  assert.equal((await post({ rates: [{ durationDays: d, label: 'T', rate: 4 }] })).status, 200)
  const r = await getRate(d)
  assert.equal(r?.maxAmount, null)
  assert.equal(r?.enabled, true)
})

test('invalid maxAmount / enabled -> 400 and nothing written', async () => {
  for (const bad of [-1, Number.POSITIVE_INFINITY, 'x', NaN]) {
    const d = nextDays(); created.push(d)
    const res = await post({ rates: [{ durationDays: d, label: 'T', rate: 3, maxAmount: bad }] })
    assert.equal(res.status, 400, String(bad))
    assert.equal(await getRate(d), undefined)
  }
  const d = nextDays(); created.push(d)
  assert.equal((await post({ rates: [{ durationDays: d, rate: 3, enabled: 'no' }] })).status, 400)
})

test('non-superadmin -> 403', async () => {
  stub.getServerSession = async () => ({ user: { id: 'a', role: 'agent' } })
  assert.equal((await GET()).status, 403)
})
