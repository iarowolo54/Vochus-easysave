import test from 'node:test'
import assert from 'node:assert/strict'
import { accruedInterest, rateOn, interestProjection, DEFAULT_ANNUAL_RATE } from '../src/lib/savings-interest'

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

// --- interestProjection: the forward-looking "next credit" nudge ---
const proj = {
  startDate: d(2026, 1, 1),
  maturityDate: d(2026, 12, 1),
  balance: 31000,
  rateSchedule: [] as { effectiveFrom: Date; annualRate: number }[],
}

test('projection: mid-month -> whole days to next anniversary + next credit at 12%', () => {
  const p = interestProjection({ ...proj, asOf: d(2026, 1, 15) })
  assert.deepEqual(p, { daysToNextInterest: 17, nextInterestAmount: 310 })
})

test('projection: on an anniversary counts to the NEXT one, not today', () => {
  const p = interestProjection({ ...proj, asOf: d(2026, 2, 1) })
  assert.deepEqual(p, { daysToNextInterest: 28, nextInterestAmount: 310 })
})

test('projection: part-day remainder rounds up (never promise it early)', () => {
  const p = interestProjection({ ...proj, asOf: new Date(Date.UTC(2026, 0, 15, 12)) })
  assert.equal(p?.daysToNextInterest, 17) // 16.5 days -> 17
})

test('projection: next anniversary exactly at maturity still earns', () => {
  const p = interestProjection({ ...proj, maturityDate: d(2026, 3, 1), asOf: d(2026, 2, 15) })
  assert.deepEqual(p, { daysToNextInterest: 14, nextInterestAmount: 310 })
})

test('projection: no anniversary before maturity -> null', () => {
  const p = interestProjection({ ...proj, maturityDate: d(2026, 2, 20), asOf: d(2026, 2, 15) })
  assert.equal(p, null)
})

test('projection: matured plan (asOf >= maturity) -> null', () => {
  assert.equal(interestProjection({ ...proj, maturityDate: d(2026, 3, 1), asOf: d(2026, 3, 1) }), null)
  assert.equal(interestProjection({ ...proj, maturityDate: d(2026, 3, 1), asOf: d(2026, 4, 1) }), null)
})

test('projection: uses the rate in effect on the next anniversary (forward-only)', () => {
  const rateSchedule = [{ effectiveFrom: d(2026, 1, 20), annualRate: 24 }]
  const p = interestProjection({ ...proj, rateSchedule, asOf: d(2026, 2, 1) })
  assert.deepEqual(p, { daysToNextInterest: 28, nextInterestAmount: 620 })
})

test('projection: zero balance -> zero next credit (UI suppresses)', () => {
  const p = interestProjection({ ...proj, balance: 0, asOf: d(2026, 1, 15) })
  assert.deepEqual(p, { daysToNextInterest: 17, nextInterestAmount: 0 })
})
