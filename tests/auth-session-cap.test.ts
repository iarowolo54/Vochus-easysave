// Absolute-cap defense-in-depth at the admin NextAuth session callback.
// The admin session callback touches no DB, so it can be driven directly with a
// synthetic { session, token }. (The agent callback does a DB read before the
// cap check, so its cap math is covered via the pure isPastAbsoluteCap tests.)
//   NEXTAUTH_SECRET=test npx tsx --test tests/auth-session-cap.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adminAuthOptions } from '../src/lib/auth-admin'
import { ABSOLUTE_SECONDS } from '../src/lib/session-policy'

const sessionCb = adminAuthOptions.callbacks?.session
type SessionArg = Parameters<NonNullable<typeof sessionCb>>[0]

function call(loginAt: number | undefined) {
  const session = { user: { name: 'Admin' }, expires: '' }
  const token = { sub: 'a1', role: 'superadmin', email: 'a@x.com', ...(loginAt != null ? { loginAt } : {}) }
  return sessionCb!({ session, token } as unknown as SessionArg)
}

const now = Math.floor(Date.now() / 1000)

test('admin session callback clears identity when past the absolute cap', async () => {
  const res = await call(now - (ABSOLUTE_SECONDS.admin + 10))
  assert.equal((res as { user?: unknown }).user, undefined)
})

test('admin session callback keeps identity within the cap', async () => {
  const res = await call(now)
  const user = (res as { user?: { role?: string } }).user
  assert.ok(user, 'user present within cap')
  assert.equal(user.role, 'superadmin')
})

test('admin session callback does NOT force-expire a legacy token with no loginAt', async () => {
  const res = await call(undefined)
  const user = (res as { user?: { role?: string } }).user
  assert.ok(user, 'legacy user present')
  assert.equal(user.role, 'superadmin')
})
