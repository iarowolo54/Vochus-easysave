// Call contract used by the customer login route: loginAt supplied at sign-in survives sign/verify.
//   NEXTAUTH_SECRET=test npx tsx --test tests/session-loginAt.int.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signCustomerToken, verifyCustomerToken, type CustomerSession } from '../src/lib/customer-auth'
import { IDLE_SECONDS } from '../src/lib/session-policy'

const session: CustomerSession = { id: 'i-loginat', customerId: 'c-loginat', name: 'Ada', agentId: 'ag-loginat' }

test('signCustomerToken(session, { loginAt }) round-trips loginAt with idle-window exp', async () => {
  // A recent anchor: verifyCustomerToken now enforces the absolute cap, so a
  // sentinel like `111` (epoch 1970) would be correctly rejected as past-cap.
  const anchor = Math.floor(Date.now() / 1000) - 60
  const token = await signCustomerToken(session, { loginAt: anchor })
  const v = (await verifyCustomerToken(token)) as
    | (CustomerSession & { loginAt?: number; iat?: number; exp?: number })
    | null
  assert.ok(v)
  assert.equal(v.loginAt, anchor)
  assert.equal((v.exp ?? 0) - (v.iat ?? 0), IDLE_SECONDS.customer)
})
