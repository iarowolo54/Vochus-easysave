// Integration tests for chat helpers:
// #14 loadChatThread returns the LATEST N messages (ascending), not the first N.
// #15 loadAgentChatList summarizes conversations in a few grouped queries,
//     only for customers who have messages, with no base64 photo.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { loadChatThread, loadAgentChatList } from '../src/lib/chat'

const rid = Math.random().toString(36).slice(2, 8)
let agentId = ''
let custA = '' // many messages
let custB = '' // a couple, one unread
let custC = '' // no messages

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `CH-${rid}`, phone: `0795${rid}`, name: 'A', location: 'x', password: 'x' } })
  agentId = a.id
  const mk = (sfx: string) => prisma.customer.create({ data: { customerId: `CH${sfx}-${rid}`, agentId: a.id, firstName: 'C', lastName: sfx, phone: `08${sfx}5${rid}`.slice(0, 11).padEnd(11, '0'), address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800', photoUrl: 'data:image/png;base64,AAAA' } })
  custA = (await mk('A')).id
  custB = (await mk('B')).id
  custC = (await mk('C')).id

  // custA: 150 messages, timestamps increasing; the last is "newest-150"
  for (let i = 1; i <= 150; i++) {
    await prisma.customerChatMessage.create({ data: { customerId: custA, sender: 'agent', message: `m${i}`, createdAt: new Date(Date.now() - (150 - i) * 1000) } })
  }
  // custB: 2 messages, one unread from the customer
  await prisma.customerChatMessage.create({ data: { customerId: custB, sender: 'agent', message: 'hi', createdAt: new Date(Date.now() - 2000) } })
  await prisma.customerChatMessage.create({ data: { customerId: custB, sender: 'customer', message: 'reply', read: false, createdAt: new Date(Date.now() - 1000) } })
})

after(async () => {
  await prisma.customerChatMessage.deleteMany({ where: { customerId: { in: [custA, custB, custC] } } })
  await prisma.customer.deleteMany({ where: { id: { in: [custA, custB, custC] } } })
  await prisma.agent.deleteMany({ where: { id: agentId } })
  await prisma.$disconnect()
})

test('#14 loadChatThread returns the latest 100, ascending', async () => {
  const msgs = await loadChatThread(prisma, custA, 100)
  assert.equal(msgs.length, 100)
  assert.equal(msgs[0].message, 'm51', 'oldest of the latest 100')
  assert.equal(msgs[99].message, 'm150', 'newest message is present')
  // ascending
  for (let i = 1; i < msgs.length; i++) assert.ok(msgs[i].createdAt >= msgs[i - 1].createdAt)
})

test('#15 loadAgentChatList: only customers with messages, correct unread, no photoUrl', async () => {
  const list = await loadAgentChatList(prisma, agentId)
  const ids = list.map(c => c.id)
  assert.ok(ids.includes(custA) && ids.includes(custB), 'conversations with messages present')
  assert.ok(!ids.includes(custC), 'customer with no messages excluded')
  const b = list.find(c => c.id === custB)!
  assert.equal(b.unread, 1)
  assert.equal(b.lastMessage, 'reply')
  assert.equal((b as Record<string, unknown>).photoUrl, undefined, 'no base64 photo in list')
})

test('#15 list is sorted most-recent first', async () => {
  const list = await loadAgentChatList(prisma, agentId)
  for (let i = 1; i < list.length; i++) {
    assert.ok((list[i - 1].lastAt?.getTime() ?? 0) >= (list[i].lastAt?.getTime() ?? 0))
  }
})
