import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deadlineFromGoLive, photoBlockMessage, photoPhase, photoStatusOf, lastSaveDay } from '../src/lib/photo-deadline'

test('deadline is 00:00 WAT starting the 4th day; go-live day is day 1', () => {
  // 13 Nov 2026 10:00 WAT = 09:00Z
  assert.equal(deadlineFromGoLive(new Date('2026-11-13T09:00:00Z')).toISOString(), '2026-11-15T23:00:00.000Z')
  // 23:30 WAT on 13 Nov is still day 1 (22:30Z)
  assert.equal(deadlineFromGoLive(new Date('2026-11-13T22:30:00Z')).toISOString(), '2026-11-15T23:00:00.000Z')
  // 00:30 WAT on 14 Nov (23:30Z on the 13th) is day 1 of a later go-live
  assert.equal(deadlineFromGoLive(new Date('2026-11-13T23:30:00Z')).toISOString(), '2026-11-16T23:00:00.000Z')
})

test('phase by time left', () => {
  const d = new Date('2026-11-15T23:00:00Z')
  assert.equal(photoPhase(null, new Date()), 'none')
  assert.equal(photoPhase(d, new Date('2026-11-13T09:00:00Z')), 'green')
  assert.equal(photoPhase(d, new Date('2026-11-14T12:00:00Z')), 'yellow')
  assert.equal(photoPhase(d, new Date('2026-11-15T12:00:00Z')), 'red')
  assert.equal(photoPhase(d, d), 'paused')
})

test('block only after the deadline and only without a photo', () => {
  const deadline = new Date('2026-11-15T23:00:00Z'), after = new Date('2026-11-16T08:00:00Z')
  assert.equal(photoBlockMessage({ hasPhoto: false, deadline, now: new Date('2026-11-15T22:59:00Z'), who: 'agent', firstName: 'Ada' }), null)
  assert.equal(photoBlockMessage({ hasPhoto: true, deadline, now: after, who: 'agent', firstName: 'Ada' }), null)
  assert.equal(photoBlockMessage({ hasPhoto: false, deadline: null, now: after, who: 'agent', firstName: 'Ada' }), null)
  assert.equal(photoBlockMessage({ hasPhoto: false, deadline, now: after, who: 'agent', firstName: 'Ada' }), 'Saving is paused until Ada’s photo is added.')
  assert.equal(photoBlockMessage({ hasPhoto: false, deadline, now: after, who: 'customer', firstName: 'Ada' }), 'Saving is paused until you add your photo.')
})

test('status: a photo wins; otherwise the latest request decides', () => {
  assert.deepEqual(photoStatusOf(true, { status: 'Rejected', rejectReason: 'x' }), { status: 'ok', rejectReason: null })
  assert.deepEqual(photoStatusOf(false, null), { status: 'missing', rejectReason: null })
  assert.deepEqual(photoStatusOf(false, { status: 'Pending', rejectReason: null }), { status: 'pending', rejectReason: null })
  assert.deepEqual(photoStatusOf(false, { status: 'Rejected', rejectReason: 'Blurred' }), { status: 'rejected', rejectReason: 'Blurred' })
  // An approved request with no photo on the customer (photo later cleared) reads as missing.
  assert.deepEqual(photoStatusOf(false, { status: 'Approved', rejectReason: null }), { status: 'missing', rejectReason: null })
})

test('last day to save is the WAT day before the deadline', () => {
  assert.equal(lastSaveDay(new Date('2026-11-15T23:00:00Z')), 'Sun 15 Nov')
})
