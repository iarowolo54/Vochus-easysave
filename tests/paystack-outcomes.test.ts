// Unit test: what counts as a definite answer from Paystack, and what stays unknown.
import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { PaystackReferenceNotFound, chargeAuthorization, verifyTransaction } from '../src/lib/paystack'

const origFetch = global.fetch
const origKey = process.env.PAYSTACK_SECRET_KEY
before(() => { process.env.PAYSTACK_SECRET_KEY = 'sk_live_not_real' })
afterEach(() => { global.fetch = origFetch })
after(() => { process.env.PAYSTACK_SECRET_KEY = origKey })

const reply = (body: unknown, status = 200) => { global.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch }
const charge = () => chargeAuthorization({ authorizationCode: 'A', email: 'a@b.c', amountNaira: 100, reference: 'autodebit-x' })

test('charge: status false on a 4xx is a definite failure, with Paystack\'s reason', async () => {
  reply({ status: false, message: 'Invalid authorization code' }, 400)
  const r = await charge()
  assert.equal(r.status, 'failed')
  assert.equal(r.gatewayResponse, 'Invalid authorization code')
})

test('charge: a 5xx says nothing about the charge, so it stays unknown', async () => {
  reply({ status: false, message: 'Server error' }, 502)
  await assert.rejects(charge)
})

test('charge: a duplicate reference may mean the first one went through, so it stays unknown', async () => {
  reply({ status: false, message: 'Duplicate Transaction Reference' }, 400)
  await assert.rejects(charge)
})

test('charge: a timeout stays unknown', async () => {
  global.fetch = (async () => { throw new Error('timed out') }) as typeof fetch
  await assert.rejects(charge)
})

test('verify: an unknown reference is its own error', async () => {
  for (const message of ['Transaction reference not found', 'Transaction reference not found.', 'Transaction not found']) {
    reply({ status: false, message }, 400)
    await assert.rejects(() => verifyTransaction('autodebit-x'), PaystackReferenceNotFound, message)
  }
})

test('verify: other refusals and server errors are not read as an unknown reference', async () => {
  for (const [body, status] of [[{ status: false, message: 'Invalid key' }, 401], [{ status: false, message: 'Transaction reference not found' }, 503]] as const) {
    reply(body, status)
    await assert.rejects(() => verifyTransaction('autodebit-x'), (e: unknown) => !(e instanceof PaystackReferenceNotFound))
  }
})
