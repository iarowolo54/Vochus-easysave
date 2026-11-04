// Unit test: freeing a customer from their locked phone, against a stub database (no real database).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PrismaClient } from '@prisma/client'
import { resetCustomerDevice } from '../src/lib/reset-device'

type Row = Record<string, unknown>
function stubDb(tokens = 2) {
  const calls = { customerUpdates: [] as Row[], tokenUpdates: [] as Row[] }
  const tx = {
    customer: { update: async (a: Row) => { calls.customerUpdates.push(a); return a } },
    biometricToken: { updateMany: async (a: Row) => { calls.tokenUpdates.push(a); return { count: tokens } } },
  }
  const db = { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as Pick<PrismaClient, '$transaction'>
  return { db, calls }
}

test('clears the lock and signs the old phone out', async () => {
  const { db, calls } = stubDb()
  await resetCustomerDevice(db, 'c1')
  assert.deepEqual(calls.customerUpdates[0], { where: { id: 'c1' }, data: { boundDeviceId: null, tokenVersion: { increment: 1 } } })
})

test('revokes only the fingerprint sign-ins that are still active, and says how many', async () => {
  const { db, calls } = stubDb(3)
  assert.equal(await resetCustomerDevice(db, 'c1'), 3)
  const where = (calls.tokenUpdates[0] as { where: Row }).where
  assert.deepEqual(where, { customerId: 'c1', revokedAt: null })
})
