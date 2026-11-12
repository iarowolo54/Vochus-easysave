// Online customers add their own photo; it goes straight on (photo deadline design). Throwaway worktree dev.db.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { prisma } from '../src/lib/prisma'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-photo-self'

let jar: Record<string, string> = {}
const require_ = createRequire(import.meta.url)
const headersPath = require_.resolve('next/headers')
require_.cache[headersPath] = {
  id: headersPath, filename: headersPath, loaded: true, children: [], paths: [],
  exports: {
    cookies: async () => ({ get: (name: string) => (jar[name] ? { name, value: jar[name] } : undefined), getAll: () => [], set: () => {} }),
    headers: async () => new Headers(),
  },
} as unknown as NodeJS.Module

const rid = Math.random().toString(36).slice(2, 8)
const P1 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='
const P0 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAA=='
let agentDbId = ''
const ids: string[] = []
let POST: (req: unknown) => Promise<Response>

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `PS-${rid}`, phone: `0798${rid}`, name: 'Agent S', location: 'x', password: 'x' } })
  agentDbId = a.id
  POST = (await import('../src/app/api/customer/photo/route')).POST as never
})
after(async () => {
  await prisma.customer.deleteMany({ where: { id: { in: ids } } })
  await prisma.agent.deleteMany({ where: { id: agentDbId } })
})

async function as(type: 'online' | 'offline', photoUrl: string | null, n: number) {
  const c = await prisma.customer.create({ data: { customerId: `PSC-${rid}-${n}`, agentId: agentDbId, type, firstName: 'Ada', lastName: `S${n}`, phone: `0803${rid}${n}`.slice(0, 11), address: '1 Rd', nokName: 'N', nokRelation: 'R', nokPhone: '08000000000', photoUrl } })
  ids.push(c.id)
  const { signCustomerToken } = await import('../src/lib/customer-auth')
  jar = { customer_token: await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'Ada S', agentId: agentDbId }) }
  return c
}
const send = (photoUrl: unknown) => POST({ json: async () => ({ photoUrl }) })

test('an online customer with no photo adds one, straight on', async () => {
  const c = await as('online', null, 1)
  const res = await send(P1)
  assert.equal(res.status, 200)
  assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).photoUrl, P1)
})

test('an offline customer is refused and nothing is stored', async () => {
  const c = await as('offline', null, 2)
  assert.equal((await send(P1)).status, 403)
  assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).photoUrl, null)
})

test('an online customer who already has a photo is refused and keeps it', async () => {
  const c = await as('online', P0, 3)
  assert.equal((await send(P1)).status, 403)
  assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).photoUrl, P0)
})

test('an empty photo is 400; no session is 401', async () => {
  await as('online', null, 4)
  assert.equal((await send('')).status, 400)
  jar = {}
  assert.equal((await send(P1)).status, 401)
})

test('/me reports the photo status, deadline and whether they can take their own', async () => {
  const { GET } = await import('../src/app/api/customer/me/route')
  await as('online', null, 5)
  let me = await (await GET()).json()
  assert.deepEqual({ status: me.photo.status, canTakeOwn: me.photo.canTakeOwn, phase: me.photo.phase }, { status: 'missing', canTakeOwn: true, phase: 'none' })
  await as('offline', null, 6)
  me = await (await GET()).json()
  assert.equal(me.photo.canTakeOwn, false)
  assert.equal(me.photo.agentName, 'Agent S')
})
