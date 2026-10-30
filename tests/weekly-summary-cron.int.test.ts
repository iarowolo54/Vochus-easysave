// Weekly summary cron wiring: Friday gate, report keys, preserved auth. Hermetic: the sender is stubbed
// and Date is faked, so no dev.db summary query, NotificationLog write, or SMTP/SMS happens.
import { test, before, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { isSummaryDay } from '../src/lib/summary-day'

const require_ = createRequire(import.meta.url)
let sendCalls = 0
const p = require_.resolve('../src/lib/weekly-summary-run')
require_.cache[p] = {
  id: p, filename: p, loaded: true, children: [], paths: [],
  exports: { sendWeeklySummaries: async () => { sendCalls++; return { emailed: 1, smsed: 2, skipped: 0, failed: 0 } } },
} as unknown as NodeJS.Module
// Installed before the route is loaded so the route binds to the stub.
const { GET } = require_('../src/app/api/cron/daily/route') as typeof import('../src/app/api/cron/daily/route')

const SECRET = `cron-secret-ws-${Math.random().toString(36).slice(2, 8)}`
const savedSecret = process.env.CRON_SECRET

const call = (authorization?: string) =>
  GET(new Request('http://localhost/api/cron/daily', { headers: authorization ? { authorization } : {} }))

before(() => { process.env.CRON_SECRET = SECRET })
after(() => {
  mock.timers.reset()
  if (savedSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = savedSecret
})

test('isSummaryDay is true only on Friday', () => {
  assert.equal(isSummaryDay(new Date(2026, 9, 30, 12)), true)
  assert.equal(isSummaryDay(new Date(2026, 9, 31, 12)), false) // Sat
  assert.equal(isSummaryDay(new Date(2026, 10, 2, 12)), false) // Mon
  assert.equal(isSummaryDay(new Date(2026, 9, 29, 12)), false) // Thu
})

test('Friday: sender called once and counts folded into report', async () => {
  sendCalls = 0
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 30, 12, 0, 0).getTime() })
  try {
    const res = await call(`Bearer ${SECRET}`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as Record<string, unknown>
    assert.equal(sendCalls, 1)
    assert.equal(body.emailed, 1)
    assert.equal(body.smsed, 2)
    assert.equal(body.summarySkipped, 0)
    assert.equal(body.summaryFailed, 0)
    for (const k of ['accrued', 'charged', 'settled']) assert.equal(typeof body[k], 'number', `missing ${k}`)
  } finally {
    mock.timers.reset()
  }
})

test('non-Friday: sender not called, summary keys default to 0', async () => {
  sendCalls = 0
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 31, 12, 0, 0).getTime() }) // Saturday
  try {
    const res = await call(`Bearer ${SECRET}`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as Record<string, unknown>
    assert.equal(sendCalls, 0)
    for (const k of ['emailed', 'smsed', 'summarySkipped', 'summaryFailed']) assert.equal(body[k], 0, k)
    for (const k of ['accrued', 'charged', 'settled']) assert.equal(typeof body[k], 'number', `missing ${k}`)
  } finally {
    mock.timers.reset()
  }
})

test('bad or absent bearer is 401', async () => {
  assert.equal((await call()).status, 401)
  assert.equal((await call('Bearer wrong')).status, 401)
})
