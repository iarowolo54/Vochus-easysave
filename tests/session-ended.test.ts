// Unit test: telling a session the server really ended from a passing failure, and leaving it safely.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leaveEndedSession, sessionHasEnded } from '../src/lib/session-ended'

const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status })

test('sessionHasEnded: a session with a user has not ended', async () => {
  assert.equal(await sessionHasEnded(json({ user: { name: 'A' }, expires: 'x' })), false)
})

test('sessionHasEnded: an answer with no user has ended', async () => {
  assert.equal(await sessionHasEnded(json({ expires: 'x' })), true)
  assert.equal(await sessionHasEnded(json({})), true)
})

test('sessionHasEnded: no clear answer is not an ended session', async () => {
  assert.equal(await sessionHasEnded(json({}, 500)), false)
  assert.equal(await sessionHasEnded(async () => { throw new Error('offline') }), false)
  assert.equal(await sessionHasEnded(async () => new Response('<html>', { status: 200 })), false)
})

test('leaveEndedSession: a working sign-out needs no fallback', async () => {
  let fell = 0
  await leaveEndedSession(async () => {}, () => { fell++ }, 5)
  await new Promise(r => setTimeout(r, 15))
  assert.equal(fell, 0)
})

test('leaveEndedSession: a failed sign-out falls back once', async () => {
  let fell = 0
  await leaveEndedSession(async () => { throw new Error('offline') }, () => { fell++ }, 5)
  await new Promise(r => setTimeout(r, 15))
  assert.equal(fell, 1)
})

test('leaveEndedSession: a sign-out that hangs falls back once it times out', async () => {
  let fell = 0
  leaveEndedSession(() => new Promise<void>(() => {}), () => { fell++ }, 5)
  await new Promise(r => setTimeout(r, 15))
  assert.equal(fell, 1)
})
