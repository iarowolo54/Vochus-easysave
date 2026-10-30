// Admin card unlink/relink hardening (handoff item 22). getServerSession is stubbed via a module
// load hook (same approach as savings-interest-admin). Rows are scoped by RUN and deleted by id.
import { test, after, before } from 'node:test'
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
const { PATCH } = require('../src/app/api/admin/cards/[serial]/route') as typeof import('../src/app/api/admin/cards/[serial]/route')

const RUN = Math.random().toString(36).slice(2, 10)
const ADMIN_ID = `adm-${RUN}`
const ADMIN_NAME = `Admin ${RUN}`
stub.getServerSession = async () => ({ user: { id: ADMIN_ID, name: ADMIN_NAME, role: 'superadmin' } })

const ids = { agent: '', custFree: '', custHasCard: '', cards: [] as string[] }
const FUTURE = new Date(Date.now() + 365 * 86400000)
const PAST = new Date(Date.now() - 86400000)

const patch = (serial: string, body: unknown) =>
  PATCH({ json: async () => body } as never, { params: Promise.resolve({ serial }) })

async function mkCard(tag: string, data: { status: string; expiryDate: Date; customerId?: string | null }) {
  const c = await prisma.memberCard.create({ data: {
    serial: `SN-${RUN}-${tag}`, batchName: `B-${RUN}`, batchId: `BID-${RUN}`, ...data,
    agentId: data.customerId ? ids.agent : null, linkedAt: data.customerId ? new Date() : null,
  } })
  ids.cards.push(c.id)
  return c
}

before(async () => {
  const agent = await prisma.agent.create({ data: {
    agentId: `AG-${RUN}`, phone: `080${RUN}`, name: `Agent ${RUN}`, location: 'Lagos', password: 'x',
  } })
  ids.agent = agent.id
  const mk = (t: string) => prisma.customer.create({ data: {
    customerId: `CU-${RUN}-${t}`, agentId: agent.id, firstName: `F${t}`, lastName: 'L', phone: `081${RUN}${t}`,
    address: 'A', nokName: 'N', nokRelation: 'R', nokPhone: '1',
  } })
  ids.custFree = (await mk('a')).id
  ids.custHasCard = (await mk('b')).id
  await mkCard('has', { status: 'Linked', expiryDate: FUTURE, customerId: ids.custHasCard })
})

after(async () => {
  M._load = realLoad
  await prisma.auditLog.deleteMany({ where: { actorId: ADMIN_ID } })
  await prisma.memberCard.deleteMany({ where: { id: { in: ids.cards } } })
  await prisma.customer.deleteMany({ where: { id: { in: [ids.custFree, ids.custHasCard] } } })
  await prisma.agent.deleteMany({ where: { id: ids.agent } })
  await prisma.$disconnect()
})

test('Blocked card: unlink and relink -> 400, card unchanged', async () => {
  const card = await mkCard('blk', { status: 'Blocked', expiryDate: FUTURE, customerId: null })
  assert.equal((await patch(card.serial, { action: 'unlink' })).status, 400)
  assert.equal((await patch(card.serial, { customerId: ids.custFree })).status, 400)
  const after = await prisma.memberCard.findUniqueOrThrow({ where: { id: card.id } })
  assert.equal(after.status, 'Blocked')
  assert.equal(after.customerId, null)
})

test('Expired card: unlink and relink -> 400, card unchanged', async () => {
  const card = await mkCard('exp', { status: 'Unlinked', expiryDate: PAST })
  assert.equal((await patch(card.serial, { action: 'unlink' })).status, 400)
  assert.equal((await patch(card.serial, { customerId: ids.custFree })).status, 400)
  const after = await prisma.memberCard.findUniqueOrThrow({ where: { id: card.id } })
  assert.equal(after.status, 'Unlinked')
  assert.equal(after.customerId, null)
})

test('Relink to a customer who already has a card -> 409, card unchanged', async () => {
  const card = await mkCard('dbl', { status: 'Unlinked', expiryDate: FUTURE })
  const res = await patch(card.serial, { customerId: ids.custHasCard })
  assert.ok([400, 409].includes(res.status), `status ${res.status}`)
  const after = await prisma.memberCard.findUniqueOrThrow({ where: { id: card.id } })
  assert.equal(after.customerId, null)
  assert.equal(after.status, 'Unlinked')
})

test('Valid relink succeeds and audits the real admin', async () => {
  const card = await mkCard('ok', { status: 'Unlinked', expiryDate: FUTURE })
  const res = await patch(card.serial, { customerId: ids.custFree })
  assert.equal(res.status, 200)
  const after = await prisma.memberCard.findUniqueOrThrow({ where: { id: card.id } })
  assert.equal(after.customerId, ids.custFree)
  assert.equal(after.status, 'Linked')
  const audit = await prisma.auditLog.findFirst({ where: { action: 'card_relink', entityId: card.id } })
  assert.equal(audit?.actorId, ADMIN_ID)
  assert.equal(audit?.actorName, ADMIN_NAME)
})

test('Healthy unlink succeeds and audits the real admin', async () => {
  const card = await mkCard('ul', { status: 'Linked', expiryDate: FUTURE, customerId: ids.custFree })
  // custFree now also owns the relinked card above; unlink only needs this card.
  const res = await patch(card.serial, { action: 'unlink' })
  assert.equal(res.status, 200)
  const after = await prisma.memberCard.findUniqueOrThrow({ where: { id: card.id } })
  assert.equal(after.status, 'Unlinked')
  assert.equal(after.customerId, null)
  const audit = await prisma.auditLog.findFirst({ where: { action: 'card_unlink', entityId: card.id } })
  assert.equal(audit?.actorId, ADMIN_ID)
  assert.equal(audit?.actorName, ADMIN_NAME)
})
