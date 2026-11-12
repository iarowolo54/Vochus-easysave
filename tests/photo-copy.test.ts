import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentReminderCopy, customerPhotoCopy, type CustomerPhoto } from '../src/lib/photo-copy'

const base: CustomerPhoto = { status: 'missing', rejectReason: null, deadline: '2026-11-15T23:00:00.000Z', lastDay: 'Sun 15 Nov', phase: 'green', canTakeOwn: true, agentName: 'Tola' }

test('nothing to say with a photo or before the clock starts', () => {
  assert.equal(customerPhotoCopy({ ...base, status: 'ok' }), null)
  assert.equal(customerPhotoCopy({ ...base, phase: 'none' }), null)
})

test('days 1-3: online customers are asked to take it; offline ones to ask their agent', () => {
  assert.deepEqual(customerPhotoCopy(base), { tone: 'green', title: 'Add your photo by Sun 15 Nov', text: 'After that you won’t be able to save until you do.', camera: true })
  assert.deepEqual(customerPhotoCopy({ ...base, phase: 'red', canTakeOwn: false }), { tone: 'red', title: 'Add your photo by Sun 15 Nov', text: 'After that you won’t be able to save until you do. Ask your agent, Tola, to take it for you.', camera: false })
})

test('paused', () => {
  assert.deepEqual(customerPhotoCopy({ ...base, phase: 'paused' }), { tone: 'red', title: 'Saving is paused', text: 'Add your photo to save again.', camera: true })
  assert.deepEqual(customerPhotoCopy({ ...base, phase: 'paused', canTakeOwn: false }), { tone: 'red', title: 'Saving is paused', text: 'Ask your agent, Tola, to take your photo.', camera: false })
})

test('a photo being checked, before and after the deadline', () => {
  assert.deepEqual(customerPhotoCopy({ ...base, status: 'pending', canTakeOwn: false, phase: 'yellow' }), { tone: 'yellow', title: 'Your photo is being checked', text: 'Your photo is being checked.', camera: false })
  assert.deepEqual(customerPhotoCopy({ ...base, status: 'pending', canTakeOwn: false, phase: 'paused' }), { tone: 'red', title: 'Saving is paused', text: 'Your photo is being checked. Saving stays paused until it’s approved.', camera: false })
})

test('agent pop-up: count, singular, paused', () => {
  assert.equal(agentReminderCopy({ phase: 'none', lastDay: null, count: 3 }), null)
  assert.equal(agentReminderCopy({ phase: 'green', lastDay: 'Sun 15 Nov', count: 0 }), null)
  assert.deepEqual(agentReminderCopy({ phase: 'yellow', lastDay: 'Sun 15 Nov', count: 3 }), { tone: 'yellow', title: '3 customers need a photo by Sun 15 Nov', text: 'After that, you can’t record savings for them until their photo is approved.' })
  assert.equal(agentReminderCopy({ phase: 'green', lastDay: 'Sun 15 Nov', count: 1 })?.title, '1 customer needs a photo by Sun 15 Nov')
  assert.deepEqual(agentReminderCopy({ phase: 'paused', lastDay: 'Sun 15 Nov', count: 2 }), { tone: 'red', title: 'Saving is paused for 2 customers', text: 'Take their photos. Saving starts again when each one is approved.' })
})
