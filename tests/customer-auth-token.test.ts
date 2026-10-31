// Customer jose token: loginAt anchor + idle exp. Real crypto (needs a secret).
//   NEXTAUTH_SECRET=test npx tsx --test tests/customer-auth-token.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signCustomerToken, verifyCustomerToken, type CustomerSession } from '../src/lib/customer-auth'
import { IDLE_SECONDS } from '../src/lib/session-policy'

const payload: CustomerSession = { id: 'i1', customerId: 'c1', name: 'Ada', agentId: 'ag1' }

test('signCustomerToken persists loginAt and the requested exp window', async () => {
  const token = await signCustomerToken(payload, { loginAt: 123, expSeconds: 3600 })
  const verified = (await verifyCustomerToken(token)) as
    | (CustomerSession & { loginAt?: number; iat?: number; exp?: number })
    | null
  assert.ok(verified, 'token should verify')
  assert.equal(verified.loginAt, 123)
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
