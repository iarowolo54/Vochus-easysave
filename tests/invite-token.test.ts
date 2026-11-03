import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateInviteToken, hashInviteToken, isInviteUsable, INVITE_TTL_MS } from '../src/lib/invite-token'

test('generateInviteToken: 64-hex raw token, sha256 hash of it, 48h expiry', () => {
  const before = Date.now()
  const t = generateInviteToken()
  assert.match(t.raw, /^[0-9a-f]{64}$/)
  assert.equal(t.hash, hashInviteToken(t.raw))
  assert.notEqual(t.hash, t.raw)
  const ttl = t.expiresAt.getTime() - before
  assert.ok(ttl >= INVITE_TTL_MS - 1000 && ttl <= INVITE_TTL_MS + 1000)
  assert.equal(INVITE_TTL_MS, 48 * 60 * 60 * 1000)
})

test('tokens are unique', () => {
  assert.notEqual(generateInviteToken().raw, generateInviteToken().raw)
})

test('hashInviteToken is deterministic', () => {
  assert.equal(hashInviteToken('abc'), hashInviteToken('abc'))
  assert.notEqual(hashInviteToken('abc'), hashInviteToken('abd'))
})

test('isInviteUsable: Invited + unexpired + hash present', () => {
  const now = new Date('2026-11-03T10:00:00Z')
  const ok = { inviteTokenHash: 'h', inviteExpiresAt: new Date('2026-11-04T10:00:00Z'), status: 'Invited' }
  assert.equal(isInviteUsable(ok, now), true)
  assert.equal(isInviteUsable({ ...ok, inviteExpiresAt: new Date('2026-11-03T09:59:59Z') }, now), false)
  assert.equal(isInviteUsable({ ...ok, status: 'Active' }, now), false)
  assert.equal(isInviteUsable({ ...ok, status: 'Suspended' }, now), false)
  assert.equal(isInviteUsable({ ...ok, inviteTokenHash: null }, now), false)
  assert.equal(isInviteUsable({ ...ok, inviteExpiresAt: null }, now), false)
})
