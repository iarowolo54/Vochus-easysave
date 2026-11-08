import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maxSinglePayment } from '../src/lib/payment-cap'

const now = new Date('2026-11-08T10:00:00Z')
const inDays = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000)

test('daily plan: amount × days left', () => {
  assert.equal(maxSinglePayment({ dailyAmount: 500, cadence: 'daily', maturityDate: inDays(10) }, now), 5000)
})

test('part day left still allows one day', () => {
  assert.equal(maxSinglePayment({ dailyAmount: 500, cadence: 'daily', maturityDate: inDays(0.2) }, now), 500)
})

test('weekly plan with 3 days left still takes a full week', () => {
  assert.equal(maxSinglePayment({ dailyAmount: 100, cadence: 'weekly', maturityDate: inDays(3) }, now), 700)
})

test('weekly plan rounds up to whole weeks', () => {
  assert.equal(maxSinglePayment({ dailyAmount: 100, cadence: 'weekly', maturityDate: inDays(10) }, now), 1400)
})

test('monthly plan counts whole 30-day months', () => {
  assert.equal(maxSinglePayment({ dailyAmount: 100, cadence: 'monthly', maturityDate: inDays(45) }, now), 6000)
})

test('flexible plans have no cap', () => {
  assert.equal(maxSinglePayment({ dailyAmount: 0, cadence: 'flexible', maturityDate: inDays(90) }, now), null)
})
