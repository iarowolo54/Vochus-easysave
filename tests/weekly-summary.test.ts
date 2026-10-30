import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isoWeekKey, weekWindow, buildWeeklySummary } from '../src/lib/weekly-summary'

const asOf = new Date(Date.UTC(2026, 9, 30, 8, 0, 0))
const plan = (balance: number, interestAccrued: number, status: string, days = 30) => ({
  balance,
  interestAccrued,
  status,
  maturityDate: new Date(asOf.getTime() + days * 86400000),
})

test('isoWeekKey', () => {
  assert.equal(isoWeekKey(asOf), '2026-W44')
  assert.equal(isoWeekKey(new Date(Date.UTC(2026, 0, 1))), '2026-W01')
  assert.equal(isoWeekKey(new Date(Date.UTC(2027, 0, 1))), '2026-W53')
})

test('weekWindow', () => {
  const w = weekWindow(asOf)
  assert.equal(w.end.getTime(), asOf.getTime())
  assert.equal(w.start.getTime(), asOf.getTime() - 7 * 86400000)
})

test('buildWeeklySummary totals and content', () => {
  const r = buildWeeklySummary({
    firstName: 'Ada',
    plans: [plan(1000, 10, 'Active', 20), plan(500, 5, 'Active', 10), plan(9999, 99, 'Completed', 1)],
    weekDeposits: [{ amount: 200 }, { amount: 100 }],
    asOf,
  })
  assert.equal(r.savedThisWeek, 300)
  assert.equal(r.totalBalance, 1500)
  assert.equal(r.interestEarned, 15)
  assert.ok(r.smsText.length <= 160)
  assert.ok(r.smsText.startsWith('Vochus: this week you saved NGN 300.'))
  assert.ok(r.emailHtml.includes('Ada'))
  for (const s of ['300', '1,500', '15']) assert.ok(r.emailHtml.includes(s), s)
  assert.ok(r.emailHtml.includes('10 day'))
})

test('large numbers keep sms within one segment', () => {
  const r = buildWeeklySummary({
    firstName: 'Ada',
    plans: [plan(9_999_999, 9_999_999, 'Active')],
    weekDeposits: [{ amount: 9_999_999.99 }],
    asOf,
  })
  assert.ok(r.smsText.length <= 160, String(r.smsText.length))
  assert.match(r.smsText, /^[\x20-\x7e]+$/)
})
