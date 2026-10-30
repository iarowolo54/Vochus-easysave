// Integration tests for the savings interest-rate store (effective-dated schedule).
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { rateOn } from '../src/lib/savings-interest'
import {
  getSavingsRateSchedule,
  getCurrentSavingsRate,
  appendSavingsRate,
} from '../src/lib/savings-interest-rate'

const TAG = `test-rate-${Math.random().toString(36).slice(2, 10)}`

async function clean() {
  await prisma.savingsInterestRate.deleteMany({})
}

beforeEach(clean)
after(async () => {
  await clean()
  await prisma.$disconnect()
})

test('empty table: current is 12 and schedule is []', async () => {
  assert.equal(await getCurrentSavingsRate(prisma), 12)
  assert.deepEqual(await getSavingsRateSchedule(prisma), [])
})

test('after append(10): current is 10, one entry effective by now', async () => {
  await appendSavingsRate(prisma, 10, TAG)
  assert.equal(await getCurrentSavingsRate(prisma), 10)
  const s = await getSavingsRateSchedule(prisma)
  assert.equal(s.length, 1)
  assert.equal(s[0].annualRate, 10)
  assert.ok(s[0].effectiveFrom.getTime() <= Date.now())
})

test('two appends: sorted ascending; date before any entry is still 12', async () => {
  await appendSavingsRate(prisma, 10, TAG)
  await new Promise((r) => setTimeout(r, 5))
  await appendSavingsRate(prisma, 8, TAG)
  const s = await getSavingsRateSchedule(prisma)
  assert.equal(s.length, 2)
  assert.ok(s[0].effectiveFrom.getTime() < s[1].effectiveFrom.getTime())
  assert.deepEqual(s.map((e) => e.annualRate), [10, 8])
  assert.equal(rateOn(s, new Date(0)), 12)
  assert.equal(await getCurrentSavingsRate(prisma), 8)
})

test('invalid rates throw and insert nothing', async () => {
  await assert.rejects(() => appendSavingsRate(prisma, -5, TAG), /annualRate/)
  await assert.rejects(() => appendSavingsRate(prisma, NaN, TAG), /annualRate/)
  assert.deepEqual(await getSavingsRateSchedule(prisma), [])
})
