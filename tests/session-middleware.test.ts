// Pure tests for the proxy decision core. Decoding is injected, so no real
// crypto/tokens are needed. Run:
//   NEXTAUTH_SECRET=test npx tsx --test tests/session-middleware.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideForRequest,
  AGENT_COOKIE,
  ADMIN_COOKIE,
  CUSTOMER_COOKIE,
  type Decoder,
  type DecodedToken,
} from '../src/lib/session-middleware'
import { IDLE_SECONDS, ABSOLUTE_SECONDS } from '../src/lib/session-policy'

const NOW = 1_800_000_000

/** A decoder that always returns the given fixed result. */
function fixed(result: DecodedToken | null): Decoder {
  return () => result
}

/** Build a decoders map that only knows about the admin cookie. */
function adminDecoder(result: DecodedToken | null): Record<string, Decoder> {
  return { [ADMIN_COOKIE]: fixed(result) }
}

test('valid admin cookie on /superadmin/x → slide, no redirect', async () => {
  const res = await decideForRequest({
    pathname: '/superadmin/x',
    cookies: { [ADMIN_COOKIE]: 'raw' },
    nowSec: NOW,
    decoders: adminDecoder({ loginAt: NOW - 60, iat: NOW - 60, claims: { role: 'superadmin' } }),
  })
  assert.equal(res.redirectTo, undefined)
  assert.equal(res.cookieActions.length, 1)
  assert.equal(res.cookieActions[0].action, 'slide')
  assert.equal(res.cookieActions[0].cookieName, ADMIN_COOKIE)
  assert.equal(res.cookieActions[0].newExp, NOW + IDLE_SECONDS.admin)
})

test('expired (decoder null) admin cookie on /superadmin/x → clear + redirect to /superadmin/login', async () => {
  const res = await decideForRequest({
    pathname: '/superadmin/x',
    cookies: { [ADMIN_COOKIE]: 'raw' },
    nowSec: NOW,
    decoders: adminDecoder(null),
  })
  assert.equal(res.redirectTo, '/superadmin/login')
  assert.deepEqual(res.cookieActions, [{ cookieName: ADMIN_COOKIE, actor: 'admin', action: 'clear' }])
})

test('garbage admin cookie (null) on /api/admin/... → clear, NO redirect', async () => {
  const res = await decideForRequest({
    pathname: '/api/admin/customers',
    cookies: { [ADMIN_COOKIE]: 'garbage' },
    nowSec: NOW,
    decoders: adminDecoder(null),
  })
  assert.equal(res.redirectTo, undefined)
  assert.deepEqual(res.cookieActions, [{ cookieName: ADMIN_COOKIE, actor: 'admin', action: 'clear' }])
})

test('no cookie on /superadmin/login → no actions, no redirect (public page)', async () => {
  const res = await decideForRequest({
    pathname: '/superadmin/login',
    cookies: {},
    nowSec: NOW,
    decoders: {},
  })
  assert.equal(res.redirectTo, undefined)
  assert.deepEqual(res.cookieActions, [])
})

test('missing/NaN loginAt → falls back to iat (then nowSec), slides, does NOT expire', async () => {
  // loginAt absent entirely: use iat.
  const viaIat = await decideForRequest({
    pathname: '/superadmin/x',
    cookies: { [ADMIN_COOKIE]: 'raw' },
    nowSec: NOW,
    decoders: adminDecoder({ iat: NOW - 10, claims: {} }),
  })
  assert.equal(viaIat.cookieActions[0].action, 'slide')
  assert.equal(viaIat.redirectTo, undefined)

  // loginAt is NaN AND no iat: fall all the way back to nowSec.
  const viaNow = await decideForRequest({
    pathname: '/superadmin/x',
    cookies: { [ADMIN_COOKIE]: 'raw' },
    nowSec: NOW,
    decoders: adminDecoder({ loginAt: Number.NaN, claims: {} }),
  })
  assert.equal(viaNow.cookieActions[0].action, 'slide')
  assert.equal(viaNow.cookieActions[0].newExp, NOW + IDLE_SECONDS.admin)
  assert.equal(viaNow.redirectTo, undefined)
})

test('absolute-cap-exceeded cookie on a PAGE → clear + redirect', async () => {
  const loginAt = NOW - ABSOLUTE_SECONDS.admin - 1
  const res = await decideForRequest({
    pathname: '/superadmin/x',
    cookies: { [ADMIN_COOKIE]: 'raw' },
    nowSec: NOW,
    decoders: adminDecoder({ loginAt, iat: loginAt, claims: { role: 'superadmin' } }),
  })
  assert.equal(res.redirectTo, '/superadmin/login')
  assert.deepEqual(res.cookieActions, [{ cookieName: ADMIN_COOKIE, actor: 'admin', action: 'clear' }])
})

test('absolute-cap-exceeded cookie on an API → clear only, NO redirect', async () => {
  const loginAt = NOW - ABSOLUTE_SECONDS.admin - 1
  const res = await decideForRequest({
    pathname: '/api/admin/customers',
    cookies: { [ADMIN_COOKIE]: 'raw' },
    nowSec: NOW,
    decoders: adminDecoder({ loginAt, iat: loginAt, claims: {} }),
  })
  assert.equal(res.redirectTo, undefined)
  assert.deepEqual(res.cookieActions, [{ cookieName: ADMIN_COOKIE, actor: 'admin', action: 'clear' }])
})

test('each cookie present is processed independently (agent + customer slide together)', async () => {
  const res = await decideForRequest({
    pathname: '/customer/dashboard',
    cookies: { [AGENT_COOKIE]: 'a', [CUSTOMER_COOKIE]: 'c' },
    nowSec: NOW,
    decoders: {
      [AGENT_COOKIE]: fixed({ loginAt: NOW - 5, claims: {} }),
      [CUSTOMER_COOKIE]: fixed({ loginAt: NOW - 5, claims: {} }),
    },
  })
  assert.equal(res.redirectTo, undefined)
  assert.equal(res.cookieActions.length, 2)
  assert.ok(res.cookieActions.every((a) => a.action === 'slide'))
})

test('guarded customer page with no customer cookie → redirect to /customer/login', async () => {
  const res = await decideForRequest({
    pathname: '/customer/dashboard',
    cookies: {},
    nowSec: NOW,
    decoders: {},
  })
  assert.equal(res.redirectTo, '/customer/login')
  assert.deepEqual(res.cookieActions, [])
})
