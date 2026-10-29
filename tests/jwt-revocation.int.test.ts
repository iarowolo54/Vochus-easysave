// Integration test for the stateless-JWT revocation gate (#11 follow-up).
// A NextAuth JWT session carries the agent's tokenVersion from login time. When
// the agent changes their password the stored tokenVersion is bumped, so every
// JWT issued before that must be rejected on its next request. The rejection
// lives in the `session` callback in src/lib/auth.ts — this exercises it
// directly against the worktree's local prisma/dev.db (no HTTP / NextAuth login
// flow needed). Randomised agentId, cleaned up, safe to re-run.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { authOptions } from '../src/lib/auth'

const rid = Math.random().toString(36).slice(2, 10)
const agentId = `JWTTEST-${rid}`.toUpperCase()
const phone = `0806${Math.floor(1000000 + Math.random() * 8999999)}`

const sessionCb = authOptions.callbacks!.session!

// Build the arguments NextAuth passes to the session callback: a session with a
// user, and the decoded JWT token carrying agentId + the tokenVersion stamped at
// login. Only agentId and tokenVersion matter to the gate.
function callSession(tokenVersion: number | undefined) {
  return sessionCb({
    session: { user: { name: 'JWT Test' } as any, expires: '' } as any,
    token: { agentId, tokenVersion } as any,
  } as any) as Promise<any>
}

before(async () => {
  await prisma.agent.create({
    data: {
      agentId,
      phone,
      name: 'JWT Test',
      location: 'Lagos',
      password: 'x',
      requiredDocs: '[]',
      status: 'Active',
      tokenVersion: 0,
    },
  })
})

after(async () => {
  await prisma.agent.deleteMany({ where: { agentId } })
  await prisma.$disconnect()
})

test('a token whose tokenVersion matches the agent keeps its user', async () => {
  const s = await callSession(0)
  assert.ok(s.user, 'user should be preserved')
  assert.equal(s.user.agentId, agentId)
})

test('after a password change (tokenVersion bumped) an old token is rejected', async () => {
  await prisma.agent.update({ where: { agentId }, data: { tokenVersion: { increment: 1 } } })
  // Old JWT still carries tokenVersion 0; stored is now 1.
  const s = await callSession(0)
  assert.equal(s.user, undefined, 'stale session must have its user cleared')
})

test('a fresh token issued after the change (matching tokenVersion) works again', async () => {
  // Agent is at tokenVersion 1 from the previous test; a new login stamps 1.
  const s = await callSession(1)
  assert.ok(s.user, 'a matching fresh token should be accepted')
  assert.equal(s.user.agentId, agentId)
})

test('a legacy token with no tokenVersion is grandfathered against a 0-version agent', async () => {
  await prisma.agent.update({ where: { agentId }, data: { tokenVersion: 0 } })
  // Tokens minted before this feature have no tokenVersion claim (undefined).
  // They must NOT be mass-logged-out while the agent is still at version 0.
  const s = await callSession(undefined)
  assert.ok(s.user, 'a pre-feature token must not be force-revoked at version 0')
})
