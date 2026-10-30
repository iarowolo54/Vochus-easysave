// Tests for the savings interest-rate store. Logic is tested with stub clients; exactly one
// real-DB round-trip touches only its own TAG-scoped row (never wipes the shared table).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { rateOn } from '../src/lib/savings-interest'
import {
  getSavingsRateSchedule,
  getCurrentSavingsRate,
  appendSavingsRate,
} from '../src/lib/savings-interest-rate'

const TAG = `test-rate-${Math.random().toString(36).slice(2, 10)}`

type Row = { effectiveFrom: Date; annualRate: number }
const stub = (rows: Row[]) =>
  ({ savingsInterestRate: { findMany: async () => rows } }) as unknown as Parameters<typeof getSavingsRateSchedule>[0]

after(async () => {
  await prisma.savingsInterestRate.deleteMany({ where: { createdBy: TAG } })
  await prisma.$disconnect()
})

test('empty schedule: current is 12 and schedule is []', async () => {
  assert.equal(await getCurrentSavingsRate(stub([])), 12)
  assert.deepEqual(await getSavingsRateSchedule(stub([])), [])
})

test('fixed rows: schedule maps through, current rate is the latest effective', async () => {
  const rows = [
    { effectiveFrom: new Date('2020-01-01T00:00:00Z'), annualRate: 10 },
    { effectiveFrom: new Date('2021-01-01T00:00:00Z'), annualRate: 8 },
    { effectiveFrom: new Date('2999-01-01T00:00:00Z'), annualRate: 1 },
  ]
  const s = await getSavingsRateSchedule(stub(rows))
  assert.deepEqual(s.map((e) => e.annualRate), [10, 8, 1])
  assert.equal(rateOn(s, new Date(0)), 12)
  assert.equal(await getCurrentSavingsRate(stub(rows)), 8)
})

test('invalid rates throw and insert nothing', async () => {
  let created = 0
  const c = { savingsInterestRate: { create: async () => { created++ } } } as unknown as Parameters<typeof appendSavingsRate>[0]
  await assert.rejects(() => appendSavingsRate(c, -5, TAG), /annualRate/)
  await assert.rejects(() => appendSavingsRate(c, NaN, TAG), /annualRate/)
  assert.equal(created, 0)
})

test('real DB: appendSavingsRate persists a tagged row effective by now', async () => {
  await appendSavingsRate(prisma, 7.5, TAG)
  const rows = await prisma.savingsInterestRate.findMany({ where: { createdBy: TAG } })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].annualRate, 7.5)
  assert.ok(rows[0].effectiveFrom.getTime() <= Date.now())
})
