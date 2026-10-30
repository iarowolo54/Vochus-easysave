import test from 'node:test'
import assert from 'node:assert/strict'
import { accruedInterest, rateOn, DEFAULT_ANNUAL_RATE } from '../src/lib/savings-interest'

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day))

test('rateOn: empty schedule -> default 12', () => {
  assert.equal(DEFAULT_ANNUAL_RATE, 12)
  assert.equal(rateOn([], d(2026, 1, 1)), 12)
})

test('rateOn: latest effective entry <= date, unsorted, boundary inclusive', () => {
  const s = [
    { effectiveFrom: d(2026, 3, 1), annualRate: 20 },
    { effectiveFrom: d(2026, 2, 1), annualRate: 15 },
  ]
  assert.equal(rateOn(s, d(2026, 1, 31)), 12)
  assert.equal(rateOn(s, d(2026, 2, 1)), 15)
  assert.equal(rateOn(s, d(2026, 3, 1)), 20)
})

const base = {
  startDate: d(2026, 1, 1),
  maturityDate: d(2026, 12, 1),
  deposits: [{ amount: 31000, createdAt: d(2026, 1, 1) }],
  rateSchedule: [],
}

test('empty schedule -> 12% baseline, one completed month', () => {
  assert.equal(accruedInterest({ ...base, asOf: d(2026, 2, 1) }), 310)
})

test('two completed months, simple (no compounding)', () => {
  assert.equal(accruedInterest({ ...base, asOf: d(2026, 3, 1) }), 620)
})

test('forward-only rate change', () => {
  const rateSchedule = [{ effectiveFrom: d(2026, 2, 15), annualRate: 24 }]
  const m1 = accruedInterest({ ...base, rateSchedule, asOf: d(2026, 2, 1) })
  const both = accruedInterest({ ...base, rateSchedule, asOf: d(2026, 3, 1) })
  assert.equal(m1, 310)
  assert.equal(money2(both - m1), 620)
})

test('rate change exactly on an anniversary applies to it', () => {
  const rateSchedule = [{ effectiveFrom: d(2026, 2, 1), annualRate: 24 }]
  assert.equal(accruedInterest({ ...base, rateSchedule, asOf: d(2026, 2, 1) }), 620)
})

test('backdated deposit counts at the earlier anniversary', () => {
  const deposits = [
    { amount: 10000, createdAt: d(2026, 1, 1) },
    { amount: 20000, createdAt: d(2026, 1, 20) }, // backdated, before Feb 1
  ]
  assert.equal(accruedInterest({ ...base, deposits, asOf: d(2026, 2, 1) }), 300)
  const late = [{ amount: 10000, createdAt: d(2026, 1, 1) }, { amount: 20000, createdAt: d(2026, 2, 2) }]
  assert.equal(accruedInterest({ ...base, deposits: late, asOf: d(2026, 2, 1) }), 100)
})

test('accrual stops at maturity', () => {
  const at = accruedInterest({ ...base, maturityDate: d(2026, 3, 1), asOf: d(2026, 3, 1) })
  const after = accruedInterest({ ...base, maturityDate: d(2026, 3, 1), asOf: d(2027, 1, 1) })
  assert.equal(at, 620)
  assert.equal(after, 620)
})

test('partial final month earns nothing', () => {
  assert.equal(accruedInterest({ ...base, asOf: d(2026, 2, 28) }), 310)
  assert.equal(accruedInterest({ ...base, asOf: d(2026, 1, 31) }), 0)
})

test('month-end clamp: Jan 31 start', () => {
  const input = {
    startDate: d(2026, 1, 31),
    maturityDate: d(2026, 12, 31),
    deposits: [{ amount: 10000, createdAt: d(2026, 1, 31) }],
    rateSchedule: [],
  }
  assert.equal(accruedInterest({ ...input, asOf: d(2026, 2, 27) }), 0)
  assert.equal(accruedInterest({ ...input, asOf: d(2026, 2, 28) }), 100) // Feb 28 anniversary
  assert.equal(accruedInterest({ ...input, asOf: d(2026, 3, 30) }), 100)
  assert.equal(accruedInterest({ ...input, asOf: d(2026, 3, 31) }), 200) // Mar 31
  assert.equal(accruedInterest({ ...input, asOf: d(2026, 4, 30) }), 300) // Apr 30
})

function money2(n: number) { return Math.round(n * 100) / 100 }
