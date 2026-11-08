import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audiencesFor, parseAnnouncement } from '../src/lib/announcements'

const good = { title: ' Office closed ', body: 'We are closed on Monday.\nSee you Tuesday.', audience: 'both', startDate: '2026-11-10', endDate: '2026-11-12' }

test('a good message is trimmed and runs whole Lagos days', () => {
  const r = parseAnnouncement(good)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.value.title, 'Office closed')
  assert.equal(r.value.startsAt.toISOString(), '2026-11-09T23:00:00.000Z')
  assert.equal(r.value.endsAt.toISOString(), '2026-11-12T22:59:59.999Z')
})

test('missing or bad fields are named', () => {
  const r = parseAnnouncement({ ...good, title: '', audience: 'everyone', endDate: '2026-11-01' })
  assert.ok(!r.ok)
  if (r.ok) return
  assert.deepEqual(Object.keys(r.errors).sort(), ['audience', 'endDate', 'title'])
})

test('too long is refused', () => {
  const r = parseAnnouncement({ ...good, body: 'x'.repeat(601) })
  assert.ok(!r.ok)
})

test('agents see agents + both; customers see customers + both', () => {
  assert.deepEqual(audiencesFor('agent'), ['agents', 'both'])
  assert.deepEqual(audiencesFor('customer'), ['customers', 'both'])
})
