// Integration tests for the server-side payment-intent binding (findings #2/#3:
// Paystack verify could claim an arbitrary reference and credit a mismatched
// amount). PaymentIntent has no FK to agent/customer, so fake actor ids are fine.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import {
  createPaymentIntent,
  findOwnedPendingIntent,
  consumePaymentIntent,
} from '../src/lib/payment-intent'

const rid = Math.random().toString(36).slice(2, 10)
const agentA = `agent-A-${rid}`
const agentB = `agent-B-${rid}`

after(async () => {
  await prisma.paymentIntent.deleteMany({ where: { ref: { startsWith: `VCHS-${rid}` } } })
  await prisma.$disconnect()
})

test('an intent is found only by its owning actor', async () => {
  const ref = `VCHS-${rid}-own`
  await createPaymentIntent({ ref, actorType: 'agent', agentId: agentA, amount: 500 })
  assert.ok(await findOwnedPendingIntent(ref, { agentId: agentA }))
  assert.equal(await findOwnedPendingIntent(ref, { agentId: agentB }), null) // other actor
  assert.equal(await findOwnedPendingIntent(`${ref}-nope`, { agentId: agentA }), null) // unknown ref
})

test('consume is single-use and atomic under concurrency', async () => {
  const ref = `VCHS-${rid}-once`
  await createPaymentIntent({ ref, actorType: 'agent', agentId: agentA, amount: 500 })
  const results = await Promise.all([
    consumePaymentIntent(prisma, ref, { agentId: agentA }),
    consumePaymentIntent(prisma, ref, { agentId: agentA }),
    consumePaymentIntent(prisma, ref, { agentId: agentA }),
  ])
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal(await findOwnedPendingIntent(ref, { agentId: agentA }), null) // now Done
  assert.equal(await consumePaymentIntent(prisma, ref, { agentId: agentA }), false)
})

test('consume rejects a non-owning actor', async () => {
  const ref = `VCHS-${rid}-owner`
  await createPaymentIntent({ ref, actorType: 'agent', agentId: agentA, amount: 500 })
  assert.equal(await consumePaymentIntent(prisma, ref, { agentId: agentB }), false)
  const still = await prisma.paymentIntent.findUnique({ where: { ref } })
  assert.equal(still?.status, 'Pending') // untouched
})
