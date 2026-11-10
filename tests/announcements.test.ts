import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audiencesFor, IMAGE_BYTES_MAX, parseAnnouncement } from '../src/lib/announcements'
import { checkPicture } from '../src/lib/announcement-images'

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

test('pictures can stand in for the text, but a message needs one or the other', () => {
  assert.ok(parseAnnouncement({ ...good, body: '', imageIds: ['a'] }).ok)
  const r = parseAnnouncement({ ...good, body: '', imageIds: [] })
  assert.ok(!r.ok)
  if (!r.ok) assert.deepEqual(Object.keys(r.errors), ['body'])
})

test('picture order is kept; more than five, repeats or non-ids are refused', () => {
  const r = parseAnnouncement({ ...good, imageIds: ['b', 'a'] })
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(r.value.imageIds, ['b', 'a'])
  for (const imageIds of [['1', '2', '3', '4', '5', '6'], ['a', 'a'], ['a', 7]]) {
    const bad = parseAnnouncement({ ...good, imageIds })
    assert.ok(!bad.ok)
    if (!bad.ok) assert.ok(bad.errors.imageIds)
  }
})

test('a picture is judged by its bytes', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
  assert.deepEqual(checkPicture(jpeg), { ok: true, mime: 'image/jpeg' })
  assert.ok(!checkPicture(Buffer.from('<svg onload="alert(1)"/>')).ok)
  assert.ok(!checkPicture(Buffer.from('%PDF-1.7')).ok)
  assert.ok(!checkPicture(Buffer.concat([jpeg, Buffer.alloc(IMAGE_BYTES_MAX)])).ok)
})
