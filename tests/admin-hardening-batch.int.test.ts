// Admin hardening batch: real audit actors, rewards PATCH validation, wallets floatLimit.
// next-auth getServerSession is stubbed at module load (same approach as savings-interest-admin).
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
/* eslint-disable @typescript-eslint/no-require-imports */
const statusRoute = require('../src/app/api/admin/agents/[id]/status/route') as typeof import('../src/app/api/admin/agents/[id]/status/route')
const lockRoute = require('../src/app/api/admin/agents/[id]/profile-lock/route') as typeof import('../src/app/api/admin/agents/[id]/profile-lock/route')
const rewardsRoute = require('../src/app/api/admin/rewards/[id]/route') as typeof import('../src/app/api/admin/rewards/[id]/route')
const walletsRoute = require('../src/app/api/admin/wallets/route') as typeof import('../src/app/api/admin/wallets/route')
/* eslint-enable @typescript-eslint/no-require-imports */

const RUN = `hb-${Math.random().toString(36).slice(2, 10)}`
const ADMIN_ID = `${RUN}-admin`
const ADMIN_NAME = `Admin ${RUN}`
const agentIds: string[] = []
const promoIds: string[] = []

beforeEach(() => {
  stub.getServerSession = async () => ({ user: { id: ADMIN_ID, name: ADMIN_NAME, role: 'superadmin' } })
})

async function mkAgent(floatLimit: number | null) {
  const a = await prisma.agent.create({
    data: { agentId: `${RUN}-${agentIds.length}`, phone: `${RUN}-p${agentIds.length}`, name: `T ${RUN}`, location: 'X', password: 'x', floatLimit },
  })
  agentIds.push(a.id)
  return a
}
async function mkPromo() {
  const p = await prisma.rewardPromo.create({ data: { name: RUN, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } })
  promoIds.push(p.id)
  return p
}
async function auditFor(entityId: string, action: string) {
  for (let i = 0; i < 40; i++) {
    const r = await prisma.auditLog.findFirst({ where: { entityId, action } })
    if (r) return r
    await new Promise(r => setTimeout(r, 50))
  }
  return null
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const jsonReq = (body: unknown) => ({ json: async () => body }) as never

after(async () => {
  M._load = realLoad
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: ADMIN_ID }, { entityId: { in: [...agentIds, ...promoIds] } }] } })
  await prisma.rewardPromo.deleteMany({ where: { id: { in: promoIds } } })
  await prisma.agent.deleteMany({ where: { id: { in: agentIds } } })
  await prisma.$disconnect()
})

test('agent status change audit carries the real admin id + name', async () => {
  const a = await mkAgent(null)
  const res = await statusRoute.PATCH(jsonReq({ status: 'Suspended' }), params(a.id))
  assert.equal(res.status, 200)
  const row = await auditFor(a.id, 'agent_status_change')
  assert.ok(row)
  assert.equal(row.actorId, ADMIN_ID)
  assert.equal(row.actorName, ADMIN_NAME)
})

test('agent profile-lock audit carries the real admin id + name', async () => {
  const a = await mkAgent(null)
  const res = await lockRoute.PATCH(jsonReq({ unlock: true }), params(a.id))
  assert.equal(res.status, 200)
  const row = await auditFor(a.id, 'agent_profile_unlock')
  assert.ok(row)
  assert.equal(row.actorId, ADMIN_ID)
  assert.equal(row.actorName, ADMIN_NAME)
})

test('rewards PATCH rejects invalid startDate / NaN amount with 400 and writes nothing', async () => {
  const p = await mkPromo()
  let res = await rewardsRoute.PATCH(jsonReq({ startDate: 'not-a-date' }), params(p.id))
  assert.equal(res.status, 400)
  res = await rewardsRoute.PATCH(jsonReq({ offlineRewardAmount: 'abc' }), params(p.id))
  assert.equal(res.status, 400)
  res = await rewardsRoute.PATCH(jsonReq({ onlineRewardAmount: Infinity }), params(p.id))
  assert.equal(res.status, 400)
  const after = await prisma.rewardPromo.findUnique({ where: { id: p.id } })
  assert.equal(after?.offlineRewardAmount, p.offlineRewardAmount)
  assert.equal(after?.startDate.getTime(), p.startDate.getTime())
})

test('rewards PATCH valid change writes an audit row with the real actor', async () => {
  const p = await mkPromo()
  const res = await rewardsRoute.PATCH(jsonReq({ offlineRewardAmount: '250' }), params(p.id))
  assert.equal(res.status, 200)
  const row = await auditFor(p.id, 'reward_promo_update')
  assert.ok(row)
  assert.equal(row.actorId, ADMIN_ID)
  assert.equal(row.actorName, ADMIN_NAME)
})

test('wallets GET rows include floatLimit', async () => {
  const a = await mkAgent(12345)
  const res = await walletsRoute.GET({} as never)
  const body = (await res.json()) as { agents: { id: string; floatLimit?: number | null }[] }
  const row = body.agents.find(x => x.id === a.id)
  assert.ok(row)
  assert.equal(row.floatLimit, 12345)
})
