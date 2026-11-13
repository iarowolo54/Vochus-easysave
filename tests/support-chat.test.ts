// Unit tests: the pure rules of the support chat (src/lib/support-chat.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BURST_GAP_MS, MESSAGE_MAX, SUPPORT_NAME, parseMessageInput, partyView, partyWhere, previewOf, startsReplyBurst,
  supportReplyEventsFrom, threadParty,
} from '../src/lib/support-chat'

// Smallest valid PNG header, base64 of the 8 magic bytes plus padding.
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64')}`

test('a message needs text or a picture, and text is trimmed', () => {
  assert.deepEqual(parseMessageInput({ message: '  hello  ' }), { ok: true, message: 'hello', imageUrl: null })
  for (const body of [{}, { message: '   ' }, { message: '', imageUrl: '' }, null, 'text', { message: 5 }]) {
    assert.equal(parseMessageInput(body).ok, false, JSON.stringify(body))
  }
})

test('a message over the limit is refused', () => {
  assert.equal(parseMessageInput({ message: 'a'.repeat(MESSAGE_MAX) }).ok, true)
  assert.equal(parseMessageInput({ message: 'a'.repeat(MESSAGE_MAX + 1) }).ok, false)
})

test('a picture must really be a picture', () => {
  const ok = parseMessageInput({ imageUrl: PNG })
  assert.deepEqual(ok, { ok: true, message: '', imageUrl: PNG })
  for (const bad of ['javascript:alert(1)', 'https://evil.test/a.png', 'data:image/svg+xml;base64,AAAA', 'data:image/jpeg;base64,' + PNG.split(',')[1], 42]) {
    assert.equal(parseMessageInput({ imageUrl: bad }).ok, false, String(bad))
  }
})

test('extra body fields are ignored, never passed through', () => {
  const r = parseMessageInput({ message: 'hi', sender: 'admin', threadId: 'x', senderName: 'Boss' })
  assert.deepEqual(r, { ok: true, message: 'hi', imageUrl: null })
})

test('a party thread is found by the party only', () => {
  assert.deepEqual(partyWhere({ type: 'agent', id: 'a1' }), { agentId: 'a1' })
  assert.deepEqual(partyWhere({ type: 'customer', id: 'c1' }), { customerId: 'c1' })
  assert.deepEqual(threadParty({ agentId: 'a1', customerId: null }), { type: 'agent', id: 'a1' })
  assert.deepEqual(threadParty({ agentId: null, customerId: 'c1' }), { type: 'customer', id: 'c1' })
  assert.equal(threadParty({ agentId: null, customerId: null }), null)
})

test('the agent or customer never sees a staff name or id', () => {
  const base = { id: 'm1', message: 'hi', imageUrl: null, readByParty: false, readByAdmin: false, createdAt: new Date() }
  const office = partyView({ ...base, sender: 'admin', senderId: 'staff-1', senderName: 'Tunde Staff' }, 'Ada Obi')
  assert.equal(office.senderName, SUPPORT_NAME)
  assert.equal(JSON.stringify(office).includes('Tunde'), false)
  assert.equal(JSON.stringify(office).includes('staff-1'), false)
  const mine = partyView({ ...base, sender: 'customer', senderId: 'c1', senderName: 'Ada Obi', readByAdmin: true }, 'Ada Obi')
  assert.equal(mine.senderName, 'Ada Obi')
  assert.equal(mine.read, true)
})

test('an office reply notifies once per burst', () => {
  const t = (min: number) => new Date(Date.UTC(2026, 10, 13, 9, min))
  assert.equal(startsReplyBurst({ sender: 'admin', createdAt: t(0) }, null), true)
  assert.equal(startsReplyBurst({ sender: 'admin', createdAt: t(5) }, { sender: 'customer', createdAt: t(4) }), true)
  assert.equal(startsReplyBurst({ sender: 'admin', createdAt: t(5) }, { sender: 'admin', createdAt: t(4) }), false)
  assert.equal(startsReplyBurst({ sender: 'admin', createdAt: new Date(t(0).getTime() + BURST_GAP_MS + 1) }, { sender: 'admin', createdAt: t(0) }), true)
  assert.equal(startsReplyBurst({ sender: 'agent', createdAt: t(5) }, null), false)
})

test('the safety net rebuilds the same notifications as the live path', () => {
  const since = new Date(Date.UTC(2026, 10, 12, 0, 0))
  const at = (h: number, m = 0) => new Date(since.getTime() + h * 3_600_000 + m * 60_000)
  const agentThread = { agentId: 'a1', customerId: null }
  const custThread = { agentId: null, customerId: 'c1' }
  const rows = [
    // Before the window: only tells us the predecessor of the next one.
    { id: 'old', threadId: 'T1', sender: 'admin', createdAt: new Date(since.getTime() - 10 * 60_000), thread: agentThread },
    { id: 'm1', threadId: 'T1', sender: 'admin', createdAt: at(0, 5), thread: agentThread }, // same burst as 'old' → none
    { id: 'm2', threadId: 'T1', sender: 'agent', createdAt: at(1), thread: agentThread },
    { id: 'm3', threadId: 'T1', sender: 'admin', createdAt: at(1, 2), thread: agentThread }, // new burst
    { id: 'm4', threadId: 'T1', sender: 'admin', createdAt: at(1, 3), thread: agentThread }, // same burst
    { id: 'm5', threadId: 'T2', sender: 'admin', createdAt: at(2), thread: custThread }, // first in range → new burst
    { id: 'm6', threadId: 'T3', sender: 'admin', createdAt: at(3), thread: { agentId: null, customerId: null } }, // account gone
  ]
  const events = supportReplyEventsFrom(rows, since)
  assert.deepEqual(events.map((e) => e.dedupeKey), ['support-reply:m3', 'support-reply:m5'])
  assert.deepEqual(events[0].recipient, { type: 'agent', id: 'a1' })
  assert.equal(events[0].href, '/dashboard/support')
  assert.deepEqual(events[1].recipient, { type: 'customer', id: 'c1' })
  assert.equal(events[1].href, '/customer/chat?with=vochus')
  assert.equal(events[1].at?.getTime(), at(2).getTime())
})

test('the list preview never shows a picture, only the word', () => {
  assert.equal(previewOf({ message: '', imageUrl: PNG }), 'Picture')
  assert.equal(previewOf({ message: 'hi', imageUrl: PNG }), 'hi')
  assert.equal(previewOf({ message: 'x'.repeat(200), imageUrl: null })?.length, 118)
  assert.equal(previewOf(undefined), null)
})
