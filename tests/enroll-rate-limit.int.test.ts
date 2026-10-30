// The enrol POST is rate-limited per IP at the very top of the handler, BEFORE
// body parsing / the OTP gate / the identity guard, so it bounds every request
// (including ones that would 400/409) and limits enumeration + DoS.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-enroll-rl'

let POST: (req: any) => Promise<Response>

before(async () => {
  POST = (await import('../src/app/api/customer/enroll/route')).POST
})

function reqFromIp(ip: string) {
  return {
    json: async () => ({}),
    headers: { get: (name: string) => (name.toLowerCase() === 'x-forwarded-for' ? ip : null) },
  }
}

test('enrol POST: 11th request from one IP within the hour is 429', async () => {
  const ip = `203.0.113.${100 + Math.floor(Math.random() * 100)}`
  for (let i = 1; i <= 10; i++) {
    const res = await POST(reqFromIp(ip))
    assert.notEqual(res.status, 429, `request ${i} should not be rate limited`)
  }
  const res = await POST(reqFromIp(ip))
  assert.equal(res.status, 429)
  const body = await res.json()
  assert.equal(body.error, 'Too many attempts. Please try again later.')
})

test('enrol POST: a different IP is not affected', async () => {
  const res = await POST(reqFromIp('198.51.100.77'))
  assert.notEqual(res.status, 429)
})
