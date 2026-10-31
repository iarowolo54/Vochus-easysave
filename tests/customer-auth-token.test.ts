// Customer jose token: loginAt anchor + idle exp. Real crypto (needs a secret).
//   NEXTAUTH_SECRET=test npx tsx --test tests/customer-auth-token.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signCustomerToken, verifyCustomerToken, type CustomerSession } from '../src/lib/customer-auth'
import { IDLE_SECONDS, ABSOLUTE_SECONDS } from '../src/lib/session-policy'

const payload: CustomerSession = { id: 'i1', customerId: 'c1', name: 'Ada', agentId: 'ag1' }

test('signCustomerToken persists loginAt and the requested exp window', async () => {
  // A recent loginAt (within the absolute cap, which verify now enforces).
  const anchor = Math.floor(Date.now() / 1000) - 60
  const token = await signCustomerToken(payload, { loginAt: anchor, expSeconds: 3600 })
  const verified = (await verifyCustomerToken(token)) as
    | (CustomerSession & { loginAt?: number; iat?: number; exp?: number })
    | null
  assert.ok(verified, 'token should verify')
  assert.equal(verified.loginAt, anchor)
  assert.equal(verified.customerId, 'c1')
  assert.equal((verified.exp ?? 0) - (verified.iat ?? 0), 3600)
})

test('signCustomerToken default exp is the customer idle window (not 30d)', async () => {
  const token = await signCustomerToken(payload)
  const verified = (await verifyCustomerToken(token)) as
    | (CustomerSession & { loginAt?: number; iat?: number; exp?: number })
    | null
  assert.ok(verified)
  assert.equal((verified.exp ?? 0) - (verified.iat ?? 0), IDLE_SECONDS.customer)
  // No loginAt supplied → claim is absent.
  assert.equal(verified.loginAt, undefined)
})

test('verifyCustomerToken rejects a token past the customer absolute cap', async () => {
  const now = Math.floor(Date.now() / 1000)
  // jose exp kept valid (long window) so the cap check — not exp — is what fires.
  const token = await signCustomerToken(payload, {
    loginAt: now - (ABSOLUTE_SECONDS.customer + 10),
    expSeconds: ABSOLUTE_SECONDS.customer + 100,
  })
  assert.equal(await verifyCustomerToken(token), null)
})

test('verifyCustomerToken accepts a within-cap token, and a legacy no-loginAt token', async () => {
  const now = Math.floor(Date.now() / 1000)
  const within = await signCustomerToken(payload, { loginAt: now, expSeconds: 3600 })
  assert.ok(await verifyCustomerToken(within), 'fresh loginAt verifies')

  // Legacy token with NO loginAt must NOT be force-expired by the cap.
  const legacy = await signCustomerToken(payload, { expSeconds: 3600 })
  assert.ok(await verifyCustomerToken(legacy), 'no-loginAt token still verifies')
})
