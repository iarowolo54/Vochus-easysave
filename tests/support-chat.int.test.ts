// Integration tests for the support chat against the local database (writes to dev.db, cleans up after itself).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import {
  adminUnreadThreads, getOrCreateThread, listThreads, partyUnreadCount, sendSupportMessage, supportSweepEvents, type Party,
} from '../src/lib/support-chat'

const rid = Math.random().toString(36).slice(2, 8)
let agentDbId = ''
let custDbId = ''
const threadIds: string[] = []

before(async () => {
  const a = await prisma.agent.create({ data: { agentId: `SUP-${rid}`, phone: `0796${rid}`, name: `Support Agent ${rid}`, location: 'x', password: 'x' } })
  agentDbId = a.id
  const c = await prisma.customer.create({
    data: {
      customerId: `SUPC-${rid}`, agentId: a.id, firstName: 'Ada', lastName: `Obi${rid}`, phone: `0807${rid}`.slice(0, 11).padEnd(11, '0'),
      address: 'x', nokName: 'n', nokRelation: 'r', nokPhone: '0800',
    },
  })
  custDbId = c.id
})

after(async () => {
  await prisma.notification.deleteMany({ where: { recipientId: { in: [agentDbId, custDbId] }, kind: 'support_reply' } })
  await prisma.supportMessage.deleteMany({ where: { threadId: { in: threadIds } } })
  await prisma.supportThread.deleteMany({ where: { id: { in: threadIds } } })
  await prisma.customer.deleteMany({ where: { id: custDbId } })
  await prisma.agent.deleteMany({ where: { id: agentDbId } })
  await prisma.$disconnect()
})

const agent = (): Party => ({ type: 'agent', id: agentDbId })
const customer = (): Party => ({ type: 'customer', id: custDbId })

test('one thread per person, even when two sends race', async () => {
  const [t1, t2] = await Promise.all([getOrCreateThread(prisma, customer()), getOrCreateThread(prisma, customer())])
  assert.equal(t1.id, t2.id)
  threadIds.push(t1.id)
  const ta = await getOrCreateThread(prisma, agent())
  threadIds.push(ta.id)
  assert.notEqual(ta.id, t1.id, 'the customer and their agent have separate threads')
  assert.equal(await prisma.supportThread.count({ where: { customerId: custDbId } }), 1)
})

test('office replies notify once per burst, inside the send', async () => {
  const t = await getOrCreateThread(prisma, customer())
  const send = (sender: 'admin' | 'customer', message: string) => sendSupportMessage(prisma, {
    threadId: t.id, party: customer(), sender, senderId: sender === 'admin' ? 'staff-x' : custDbId,
    senderName: sender === 'admin' ? 'Staff Person' : 'Ada', message, imageUrl: null,
  })
  await send('customer', 'Hello, my deposit is missing')
  const r1 = await send('admin', 'Looking into it')
  await send('admin', 'Found it')
  await send('customer', 'Thanks')
  const r2 = await send('admin', 'You are welcome')

  const notes = await prisma.notification.findMany({ where: { recipientId: custDbId, kind: 'support_reply' }, orderBy: { createdAt: 'asc' } })
  assert.deepEqual(notes.map((n) => n.dedupeKey), [`support-reply:${r1.id}`, `support-reply:${r2.id}`])
  assert.equal(notes.some((n) => (n.body ?? '').includes('Looking')), false, 'the message text never goes into a notification')
  assert.equal(await prisma.notification.count({ where: { recipientId: agentDbId, kind: 'support_reply' } }), 0, 'the agent is not told about the customer’s chat')

  // The safety net finds nothing missing.
  const events = await supportSweepEvents(prisma, new Date(Date.now() - 3_600_000))
  const mine = events.filter((e) => e.recipient.id === custDbId)
  assert.deepEqual(mine.map((e) => e.dedupeKey).sort(), notes.map((n) => n.dedupeKey).sort())
})

test('unread counts: the party sees office messages, the office sees party messages', async () => {
  assert.equal(await partyUnreadCount(prisma, customer()), 3)
  assert.equal(await partyUnreadCount(prisma, agent()), 0, 'never counts another person’s thread')
  assert.ok(await adminUnreadThreads(prisma) >= 1)
})

test('a party message reopens a closed thread and moves it to the top', async () => {
  const t = await getOrCreateThread(prisma, customer())
  await prisma.supportThread.update({ where: { id: t.id }, data: { status: 'Closed' } })
  await sendSupportMessage(prisma, { threadId: t.id, party: customer(), sender: 'customer', senderId: custDbId, senderName: 'Ada', message: 'One more thing', imageUrl: null })
  const after = await prisma.supportThread.findUniqueOrThrow({ where: { id: t.id } })
  assert.equal(after.status, 'Open')

  const { threads } = await listThreads(prisma, { q: `Obi${rid}`, page: 1, pageSize: 10 })
  assert.equal(threads.length, 1)
  assert.equal(threads[0].party?.type, 'customer')
  assert.equal(threads[0].preview, 'One more thing')
  assert.ok(threads[0].unread >= 1)
  const byCode = await listThreads(prisma, { q: `SUP-${rid}`, type: 'agent', page: 1, pageSize: 10 })
  assert.equal(byCode.total, 1, 'search by agent ID, filtered to agents')
})
