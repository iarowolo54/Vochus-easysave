// Call contract used by the customer login route: loginAt supplied at sign-in survives sign/verify.
//   NEXTAUTH_SECRET=test npx tsx --test tests/session-loginAt.int.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signCustomerToken, verifyCustomerToken, type CustomerSession } from '../src/lib/customer-auth'
import { IDLE_SECONDS } from '../src/lib/session-policy'

const session: CustomerSession = { id: 'i-loginat', customerId: 'c-loginat', name: 'Ada', agentId: 'ag-loginat' }

test('signCustomerToken(session, { loginAt }) round-trips loginAt with idle-window exp', async () => {
  const token = await signCustomerToken(session, { loginAt: 111 })
  const v = (await verifyCustomerToken(token)) as
    | (CustomerSession & { loginAt?: number; iat?: number; exp?: number })
    | null
  assert.ok(v)
  assert.equal(v.loginAt, 111)
  assert.equal((v.exp ?? 0) - (v.iat ?? 0), IDLE_SECONDS.customer)
})
