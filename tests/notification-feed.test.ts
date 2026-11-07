// Unit test: a feed only ever asks for one recipient's rows, and "new" means since the last look (or the last 7 days).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countNew, loadFeed, newSince } from '../src/lib/notification-feed'

const now = new Date(2026, 10, 7, 12)

function stub(rows: { id: string; createdAt: Date }[]) {
  const seen: { where: Record<string, unknown> }[] = []
  const client = { notification: {
    count: async (a: { where: Record<string, unknown> }) => { seen.push(a); return 3 },
    findMany: async (a: { where: Record<string, unknown> }) => { seen.push(a); return rows.map(r => ({ ...r, kind: 'k', title: 't', body: null, href: '/x' })) },
  } } as unknown as Parameters<typeof loadFeed>[0]
  return { client, seen }
}

test('queries are always scoped to the one recipient', async () => {
  const s = stub([])
  await countNew(s.client, 'agent', 'a1', null, now)
  await loadFeed(s.client, 'customer', 'c9', null, now)
  assert.equal(s.seen[0].where.recipientType, 'agent'); assert.equal(s.seen[0].where.recipientId, 'a1')
  assert.equal(s.seen[1].where.recipientType, 'customer'); assert.equal(s.seen[1].where.recipientId, 'c9')
})

test('first visit: only the last 7 days are new; afterwards, only what came after the last look', async () => {
  assert.equal(newSince(null, now).getTime(), now.getTime() - 7 * 86_400_000)
  const looked = new Date(2026, 10, 7, 9)
  const s = stub([{ id: 'n2', createdAt: new Date(2026, 10, 7, 10) }, { id: 'n1', createdAt: new Date(2026, 10, 7, 8) }])
  const f = await loadFeed(s.client, 'customer', 'c1', looked, now)
  assert.deepEqual(f.items.map(i => [i.id, i.isNew]), [['n2', true], ['n1', false]])
  assert.equal(f.newCount, 1)
})
