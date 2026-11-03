// The Chat tab's unread count: read-only, signed-in customers only, their own thread only.
process.env.NEXTAUTH_URL = 'http://localhost:3000'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { prisma } from '../src/lib/prisma'

const rid = Math.random().toString(36).slice(2, 8)
let agentId = ''
let a = { id: '', customerId: '' }
let b = { id: '', customerId: '' }
const customerIds: string[] = []

let currentToken = ''
const require_ = createRequire(import.meta.url)
const headersPath = require_.resolve('next/headers')
require_.cache[headersPath] = {
  id: headersPath, filename: headersPath, loaded: true, children: [], paths: [],
  exports: { cookies: async () => ({ get: (name: string) => (name === 'customer_token' && currentToken ? { name, value: currentToken } : undefined) }) },
} as unknown as NodeJS.Module

async function mk(n: number) {
  const c = await prisma.customer.create({
    data: { customerId: `UNR-${rid}-${n}`, agentId, firstName: 'C', lastName: 'X', phone: `08${rid}${n}`.padEnd(11, '0').slice(0, 11), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800' },
  })
  customerIds.push(c.id)
  return { id: c.id, customerId: c.customerId }
}
const say = (customerId: string, sender: string, read = false) =>
  prisma.customerChatMessage.create({ data: { customerId, sender, senderId: sender, senderName: sender, message: 'hi', read } })
const signIn = async (c: { id: string; customerId: string }) => {
  const { signCustomerToken } = await import('../src/lib/customer-auth')
  currentToken = await signCustomerToken({ id: c.id, customerId: c.customerId, name: 'C X', agentId })
}
const unread = async () => {
  const { GET } = await import('../src/app/api/customer/chat/unread/route')
  const res = await GET()
  return { status: res.status, body: JSON.parse(await res.text()) as { count?: number } }
}

before(async () => {
  const ag = await prisma.agent.create({ data: { agentId: `UNR-${rid}`, phone: `0794${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = ag.id
  a = await mk(1)
  b = await mk(2)
})

after(async () => {
  await prisma.customerChatMessage.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('a signed-out caller gets 401 and no count', async () => {
  currentToken = ''
  const r = await unread()
  assert.equal(r.status, 401)
  assert.equal(r.body.count, undefined)
})

test('it counts unread messages from the agent and the office, not the customer\'s own, not read ones, not another customer\'s', async () => {
  await say(a.id, 'agent')
  await say(a.id, 'agent')
  await say(a.id, 'admin')
  await say(a.id, 'customer')
  await say(a.id, 'agent', true)
  await say(b.id, 'agent')
  await signIn(a)
  assert.equal((await unread()).body.count, 3)
  await signIn(b)
  assert.equal((await unread()).body.count, 1)
})

test('asking is read-only: the count stays until the chat itself is opened', async () => {
  await signIn(a)
  assert.equal((await unread()).body.count, 3)
  assert.equal((await unread()).body.count, 3)
  assert.equal(await prisma.customerChatMessage.count({ where: { customerId: a.id, read: false } }), 4, 'nothing was marked read (the customer\'s own message is stored unread and is not counted)')

  const { GET: openChat } = await import('../src/app/api/customer/chat/route')
  assert.equal((await openChat()).status, 200)
  assert.equal((await unread()).body.count, 0)
})

test('a customer with no messages gets 0, not an error', async () => {
  const c = await mk(3)
  await signIn(c)
  assert.deepEqual(await unread(), { status: 200, body: { count: 0 } })
})
