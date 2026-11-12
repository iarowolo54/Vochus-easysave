// Route-level checks for agent photo submission and the Ajo "blocked" flag (photo deadline). Throwaway worktree dev.db.
import { test, before, after } from 'node:test'
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
const photoRoute = require('../src/app/api/customers/[id]/photo/route') as typeof import('../src/app/api/customers/[id]/photo/route')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { photoBlockedIds } = require('../src/lib/photo-deadline') as typeof import('../src/lib/photo-deadline')

const rid = Math.random().toString(36).slice(2, 8)
const P1 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='
let agentDbId = ''
const customerIds: string[] = []

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `PR-${rid}`, phone: `0797${rid}`, name: 'Agent R', location: 'x', password: 'x' } })
  agentDbId = a.id
  stub.getServerSession = async () => ({ user: { agentId: a.agentId } })
})
after(async () => {
  await prisma.platformSetting.deleteMany({ where: { key: 'photoDeadline' } })
  await prisma.customerPhotoRequest.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: agentDbId } })
})

async function mk(n: number, photoUrl: string | null = null) {
  const c = await prisma.customer.create({ data: { customerId: `PRC-${rid}-${n}`, agentId: agentDbId, firstName: 'Ada', lastName: `R${n}`, phone: `0802${rid}${n}`.slice(0, 11), address: '1 Rd', nokName: 'N', nokRelation: 'R', nokPhone: '08000000000', photoUrl } })
  customerIds.push(c.id)
  return c
}

test("the agent's photo goes to review and the customer's photo is unchanged", async () => {
  const c = await mk(1)
  const res = await photoRoute.POST({ json: async () => ({ photoUrl: P1 }) } as never, { params: Promise.resolve({ id: c.id }) })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, status: 'pending' })
  assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).photoUrl, null)
  assert.equal(await prisma.customerPhotoRequest.count({ where: { customerId: c.id, status: 'Pending' } }), 1)
})

test('blocked ids: none before the deadline; after it, only customers with no photo', async () => {
  const noPhoto = await mk(2), withPhoto = await mk(3, P1)
  assert.equal((await photoBlockedIds(prisma, [noPhoto.id, withPhoto.id])).size, 0)
  await prisma.platformSetting.upsert({ where: { key: 'photoDeadline' }, update: { value: new Date(Date.now() - 1000).toISOString() }, create: { key: 'photoDeadline', value: new Date(Date.now() - 1000).toISOString() } })
  assert.deepEqual([...(await photoBlockedIds(prisma, [noPhoto.id, withPhoto.id]))], [noPhoto.id])
})
