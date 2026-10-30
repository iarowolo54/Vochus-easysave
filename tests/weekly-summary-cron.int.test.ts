// Weekly summary cron wiring: Friday gate helper + report keys + preserved auth/existing passes.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { GET } from '../src/app/api/cron/daily/route'
import { isSummaryDay } from '../src/lib/summary-day'

const SECRET = `cron-secret-ws-${Math.random().toString(36).slice(2, 8)}`
const savedSecret = process.env.CRON_SECRET

const call = (authorization?: string) =>
  GET(new Request('http://localhost/api/cron/daily', { headers: authorization ? { authorization } : {} }))

before(() => { process.env.CRON_SECRET = SECRET })
after(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = savedSecret
})

test('isSummaryDay is true only on Friday', () => {
  // Local-time constructors: 2026-10-30 is a Friday.
  assert.equal(isSummaryDay(new Date(2026, 9, 30, 12)), true)
  assert.equal(isSummaryDay(new Date(2026, 9, 31, 12)), false) // Sat
  assert.equal(isSummaryDay(new Date(2026, 10, 2, 12)), false) // Mon
  assert.equal(isSummaryDay(new Date(2026, 9, 29, 12)), false) // Thu
})

test('cron report includes summary keys and existing keys', async () => {
  const res = await call(`Bearer ${SECRET}`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as Record<string, unknown>
  for (const k of ['emailed', 'smsed', 'summarySkipped', 'summaryFailed', 'accrued', 'charged', 'settled']) {
    assert.equal(typeof body[k], 'number', `missing numeric key ${k}`)
  }
})

test('bad or absent bearer is 401', async () => {
  assert.equal((await call()).status, 401)
  assert.equal((await call('Bearer wrong')).status, 401)
})
