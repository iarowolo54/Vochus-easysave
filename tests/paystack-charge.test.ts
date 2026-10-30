import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chargeAuthorization, verifyTransaction, initCardAuthorization } from '../src/lib/paystack'

const origFetch = global.fetch
const origKey = process.env.PAYSTACK_SECRET_KEY

describe('paystack charge client', () => {
  after(() => {
    global.fetch = origFetch
    if (origKey === undefined) delete process.env.PAYSTACK_SECRET_KEY
    else process.env.PAYSTACK_SECRET_KEY = origKey
  })

  describe('test mode', () => {
    before(() => { process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy' })

    test('chargeAuthorization returns deterministic success', async () => {
      const r = await chargeAuthorization({
        authorizationCode: 'AUTH_x', email: 'a@b.co', amountNaira: 500, reference: 'autodebit-x-20261030',
      })
      assert.equal(r.status, 'success')
      assert.equal(r.reference, 'autodebit-x-20261030')
    })

    test('verifyTransaction returns success for autodebit ref', async () => {
      const r = await verifyTransaction('autodebit-x-20261030')
      assert.equal(r.status, 'success')
      assert.equal(r.currency, 'NGN')
    })

    test('initCardAuthorization returns url and reference', async () => {
      const r = await initCardAuthorization({ email: 'a@b.co', amountNaira: 50, reference: 'VCHS-1', metadata: {} })
      assert.equal(r.reference, 'VCHS-1')
      assert.ok(r.authorizationUrl)
    })
  })

  describe('request shaping (live key, stubbed fetch)', () => {
    before(() => { process.env.PAYSTACK_SECRET_KEY = 'sk_live_dummy' })

    test('chargeAuthorization POSTs kobo amount and NGN currency', async () => {
      let url = ''
      let init: RequestInit | undefined
      global.fetch = (async (u: string | URL | Request, i?: RequestInit) => {
        url = String(u); init = i
        return new Response(JSON.stringify({
          status: true, data: { status: 'success', reference: 'R1', gateway_response: 'Successful' },
        }))
      }) as typeof fetch
      const r = await chargeAuthorization({
        authorizationCode: 'AUTH_x', email: 'a@b.co', amountNaira: 1234.56, reference: 'R1',
      })
      assert.ok(url.endsWith('/transaction/charge_authorization'))
      assert.equal(init?.method, 'POST')
      const body = JSON.parse(String(init?.body))
      assert.equal(body.amount, Math.round(1234.56 * 100))
      assert.equal(body.currency, 'NGN')
      assert.equal(body.authorization_code, 'AUTH_x')
      assert.equal(r.status, 'success')
      assert.equal(r.gatewayResponse, 'Successful')
    })

    test('verifyTransaction converts kobo to naira', async () => {
      global.fetch = (async () => new Response(JSON.stringify({
        status: true,
        data: { status: 'success', amount: 150050, currency: 'NGN', channel: 'card', authorization: { authorization_code: 'AUTH_1', signature: 's', reusable: true } },
      }))) as typeof fetch
      const r = await verifyTransaction('R1')
      assert.equal(r.amountNaira, 1500.5)
      assert.equal(r.authorization?.authorization_code, 'AUTH_1')
    })
  })
})
