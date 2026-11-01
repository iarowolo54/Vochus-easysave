// Pure tests for the proxy decision core. Decoding is injected, so no real
// crypto/tokens are needed. Run:
//   NEXTAUTH_SECRET=test npx tsx --test tests/session-middleware.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideForRequest,
  strippedCookieHeader,
  HEARTBEAT_PATH,
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

test('valid admin cookie on a PAGE (non-ping) → NO slide action, NO redirect (still logged in)', async () => {
  const res = await decideForRequest({
    pathname: '/superadmin/x',
    cookies: { [ADMIN_COOKIE]: 'raw' },
    nowSec: NOW,
    decoders: adminDecoder({ loginAt: NOW - 60, iat: NOW - 60, claims: { role: 'superadmin' } }),
  })
  // The critical correctness point: a valid session on a normal page is NOT
  // re-issued (pollers must not keep it alive) and must NOT be redirected.
  assert.equal(res.redirectTo, undefined)
  assert.deepEqual(res.cookieActions, [])
})

test('valid admin cookie on the heartbeat /api/session/ping → slide (idle window extended)', async () => {
  const res = await decideForRequest({
    pathname: HEARTBEAT_PATH,
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

test('valid admin cookie on a non-ping API → NO slide, no redirect, state stays valid (authz source)', async () => {
  const res = await decideForRequest({
    pathname: '/api/admin/customers',
    cookies: { [ADMIN_COOKIE]: 'raw' },
    nowSec: NOW,
    decoders: adminDecoder({ loginAt: NOW - 60, iat: NOW - 60, claims: { role: 'superadmin' } }),
  })
  assert.equal(res.redirectTo, undefined)
  assert.deepEqual(res.cookieActions, [])
  // The proxy keys admin authz off this state (no slide action exists here).
  assert.deepEqual(res.cookieStates, [
    { cookieName: ADMIN_COOKIE, actor: 'admin', status: 'valid', claims: { role: 'superadmin' } },
  ])
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

test('decoder that THROWS (malformed JWE) → treated as logged out, clear + redirect, never a 500', async () => {
  const throwing: Record<string, Decoder> = {
    [ADMIN_COOKIE]: async () => {
      throw new Error('JWEInvalid: malformed cookie')
    },
  }
  // On a page the thrown decode must become a clean redirect (not an unhandled throw).
  const page = await decideForRequest({
    pathname: '/superadmin/dashboard',
    cookies: { [ADMIN_COOKIE]: 'totally-not-a-jwe' },
    nowSec: NOW,
    decoders: throwing,
  })
  assert.equal(page.redirectTo, '/superadmin/login')
  assert.deepEqual(page.cookieActions, [{ cookieName: ADMIN_COOKIE, actor: 'admin', action: 'clear' }])

  // On an API the thrown decode must clear without redirect, also without throwing.
  const api = await decideForRequest({
    pathname: '/api/admin/customers',
    cookies: { [ADMIN_COOKIE]: 'totally-not-a-jwe' },
    nowSec: NOW,
    decoders: throwing,
  })
  assert.equal(api.redirectTo, undefined)
  assert.deepEqual(api.cookieActions, [{ cookieName: ADMIN_COOKIE, actor: 'admin', action: 'clear' }])
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

test('missing/NaN loginAt → falls back to iat (then nowSec), slides on heartbeat, does NOT expire', async () => {
  // loginAt absent entirely: use iat. (Heartbeat path so the slide is emitted.)
  const viaIat = await decideForRequest({
    pathname: HEARTBEAT_PATH,
    cookies: { [ADMIN_COOKIE]: 'raw' },
    nowSec: NOW,
    decoders: adminDecoder({ iat: NOW - 10, claims: {} }),
  })
  assert.equal(viaIat.cookieActions[0].action, 'slide')
  assert.equal(viaIat.redirectTo, undefined)

  // loginAt is NaN AND no iat: fall all the way back to nowSec.
  const viaNow = await decideForRequest({
    pathname: HEARTBEAT_PATH,
    cookies: { [ADMIN_COOKIE]: 'raw' },
    nowSec: NOW,
    decoders: adminDecoder({ loginAt: Number.NaN, claims: {} }),
  })
  assert.equal(viaNow.cookieActions[0].action, 'slide')
  assert.equal(viaNow.cookieActions[0].newExp, NOW + IDLE_SECONDS.admin)
  assert.equal(viaNow.redirectTo, undefined)

  // And on a non-heartbeat page, the same valid-fallback cookie is left alone
  // (no slide) but is NOT force-expired/redirected.
  const onPage = await decideForRequest({
    pathname: '/superadmin/x',
    cookies: { [ADMIN_COOKIE]: 'raw' },
    nowSec: NOW,
    decoders: adminDecoder({ iat: NOW - 10, claims: {} }),
  })
  assert.deepEqual(onPage.cookieActions, [])
  assert.equal(onPage.redirectTo, undefined)
})

test('slide action persists the resolved loginAt anchor (claim → iat → nowSec)', async () => {
  // No loginAt claim but iat=X → slide carries loginAt===X (so the anchor is
  // frozen, not re-derived from a fresh iat on the next slide). Heartbeat path.
  const X = NOW - 500
  const viaIat = await decideForRequest({
    pathname: HEARTBEAT_PATH,
    cookies: { [ADMIN_COOKIE]: 'raw' },
    nowSec: NOW,
    decoders: adminDecoder({ iat: X, claims: {} }),
  })
  assert.equal(viaIat.cookieActions[0].action, 'slide')
  assert.equal(viaIat.cookieActions[0].loginAt, X)

  // Neither loginAt nor iat → loginAt===nowSec.
  const viaNow = await decideForRequest({
    pathname: HEARTBEAT_PATH,
    cookies: { [ADMIN_COOKIE]: 'raw' },
    nowSec: NOW,
    decoders: adminDecoder({ claims: {} }),
  })
  assert.equal(viaNow.cookieActions[0].action, 'slide')
  assert.equal(viaNow.cookieActions[0].loginAt, NOW)

  // Explicit loginAt claim is preserved verbatim.
  const viaClaim = await decideForRequest({
    pathname: HEARTBEAT_PATH,
    cookies: { [ADMIN_COOKIE]: 'raw' },
    nowSec: NOW,
    decoders: adminDecoder({ loginAt: X, iat: NOW, claims: {} }),
  })
  assert.equal(viaClaim.cookieActions[0].loginAt, X)
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

test('each cookie present is processed independently (both slide on the heartbeat)', async () => {
  const res = await decideForRequest({
    pathname: HEARTBEAT_PATH,
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

test('a valid cookie alongside an expired one: non-ping page clears only the expired, no redirect for the valid actor', async () => {
  // Agent valid (on a customer page the agent cookie just rides along untouched);
  // customer expired → cleared → customer page redirects to its login.
  const res = await decideForRequest({
    pathname: '/customer/dashboard',
    cookies: { [AGENT_COOKIE]: 'a', [CUSTOMER_COOKIE]: 'c' },
    nowSec: NOW,
    decoders: {
      [AGENT_COOKIE]: fixed({ loginAt: NOW - 5, claims: {} }),
      [CUSTOMER_COOKIE]: fixed(null),
    },
  })
  assert.equal(res.redirectTo, '/customer/login')
  // Agent (valid) → no action; customer (expired) → clear.
  assert.deepEqual(res.cookieActions, [{ cookieName: CUSTOMER_COOKIE, actor: 'customer', action: 'clear' }])
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

test('strippedCookieHeader removes only the cleared names, keeps the rest', () => {
  assert.equal(
    strippedCookieHeader(`${AGENT_COOKIE}=a; ${CUSTOMER_COOKIE}=b`, [CUSTOMER_COOKIE]),
    `${AGENT_COOKIE}=a`,
  )
  // clearing a name that is not present is a no-op (order/content preserved)
  assert.equal(
    strippedCookieHeader(`${AGENT_COOKIE}=a; ${CUSTOMER_COOKIE}=b`, [ADMIN_COOKIE]),
    `${AGENT_COOKIE}=a; ${CUSTOMER_COOKIE}=b`,
  )
  // clearing the only cookie yields an empty header
  assert.equal(strippedCookieHeader(`${CUSTOMER_COOKIE}=b`, [CUSTOMER_COOKIE]), '')
  // absent/empty header → empty
  assert.equal(strippedCookieHeader(undefined, [CUSTOMER_COOKIE]), '')
  assert.equal(strippedCookieHeader('', [CUSTOMER_COOKIE]), '')
  // a value containing '=' (e.g. padded base64) is matched by name only
  assert.equal(
    strippedCookieHeader(`${ADMIN_COOKIE}=x==; ${AGENT_COOKIE}=a`, [ADMIN_COOKIE]),
    `${AGENT_COOKIE}=a`,
  )
})
