// Unit test: the new savings fee rules (offline daily first-day amount, weekly/monthly deposit fee) and their splits.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { depositFee, feeSentence, planFeePreview, settleUpFee, type FeeRules } from '../src/lib/savings-fee'

const R: FeeRules = { dailyFirstAgentPct: 60, periodicFeePct: 7.5, periodicAgentPct: 60 }
const daily = (feeCollected: number, deposit: number, dailyAmount = 500) => ({ cadence: 'daily', dailyAmount, feeCollected, deposit })

test('a daily deposit of one day takes that day as the fee, split 60/40', () => {
  assert.deepEqual(depositFee(daily(0, 500), R), { fee: 500, agent: 300, platform: 200 })
})

test('a bigger first deposit still only takes one day\'s amount', () => {
  assert.equal(depositFee(daily(0, 1500), R).fee, 500)
})

test('three part-payments of 300 take 300, then 200, then nothing', () => {
  let collected = 0
  const taken: number[] = []
  for (let i = 0; i < 3; i++) { const f = depositFee(daily(collected, 300), R).fee; taken.push(f); collected += f }
  assert.deepEqual(taken, [300, 200, 0])
})

test('a deposit smaller than what is owed is all fee', () => {
  assert.equal(depositFee(daily(0, 100), R).fee, 100)
})

test('a null cadence counts as daily', () => {
  assert.equal(depositFee({ cadence: null, dailyAmount: 500, feeCollected: 0, deposit: 500 }, R).fee, 500)
})

test('weekly and monthly take the percentage of each deposit, and the shares add up to the fee', () => {
  const w = depositFee({ cadence: 'weekly', dailyAmount: 1000, feeCollected: 0, deposit: 1001 }, R)
  assert.equal(w.fee, 75.08)
  assert.equal(w.agent + w.platform, w.fee)
  assert.equal(depositFee({ cadence: 'monthly', dailyAmount: 1000, feeCollected: 0, deposit: 1000 }, R).fee, 75)
})

test('a fee rate of 0 takes nothing', () => {
  assert.equal(depositFee({ cadence: 'weekly', dailyAmount: 1000, feeCollected: 0, deposit: 1000 }, { ...R, periodicFeePct: 0 }).fee, 0)
})

test('settle-up on a daily plan collects the first day still owed, capped at the balance', () => {
  const base = { cadence: 'daily', dailyAmount: 500, feeCollected: 0, preGoLiveDeposits: 0 }
  assert.equal(settleUpFee({ ...base, balance: 5000 }, R).fee, 500)
  assert.equal(settleUpFee({ ...base, balance: 300 }, R).fee, 300)
  assert.equal(settleUpFee({ ...base, feeCollected: 500, balance: 5000 }, R).fee, 0)
})

test('settle-up on a weekly plan is the percentage of the older deposits still in the balance', () => {
  const base = { cadence: 'weekly', dailyAmount: 1000, feeCollected: 0 }
  assert.equal(settleUpFee({ ...base, balance: 30000, preGoLiveDeposits: 40000 }, R).fee, 2250)
  assert.equal(settleUpFee({ ...base, balance: 30000, preGoLiveDeposits: 0 }, R).fee, 0)
})

test('plan previews: daily shows the first-day amount, weekly the percentage of the total', () => {
  assert.deepEqual(planFeePreview({ cadence: 'daily', amountPerPayment: 500, totalSaved: 45000, periodicFeePct: 7.5 }), { kind: 'first-day', total: 500 })
  assert.deepEqual(planFeePreview({ cadence: 'weekly', amountPerPayment: 10000, totalSaved: 100000, periodicFeePct: 7.5 }), { kind: 'percent', total: 7500 })
})

test('feeSentence says what the old rule says before go-live', () => {
  assert.equal(feeSentence({ live: false, cadence: 'daily', amountPerPayment: 500, periodicFeePct: 7.5 }), 'A platform fee is taken when they collect.')
})

test('feeSentence for a live daily plan names the first day\'s amount', () => {
  assert.equal(feeSentence({ live: true, cadence: 'daily', amountPerPayment: 500, periodicFeePct: 7.5 }), 'The first day\'s savings (₦500) is the platform fee, taken from their first deposit.')
})

test('feeSentence for a live weekly or monthly plan names the percentage', () => {
  assert.equal(feeSentence({ live: true, cadence: 'weekly', amountPerPayment: 10000, periodicFeePct: 7.5 }), 'A platform fee of 7.5% is taken from each deposit.')
  assert.equal(feeSentence({ live: true, cadence: 'monthly', amountPerPayment: 10000, periodicFeePct: 5 }), 'A platform fee of 5% is taken from each deposit.')
})

const flex = { cadence: 'flexible', dailyAmount: 0, feeCollected: 0 }

test('a flexible deposit takes no fee, even though it is not daily', () => {
  assert.deepEqual(depositFee({ ...flex, deposit: 2000 }, R), { fee: 0, agent: 0, platform: 0 })
})

test('settle-up on a flexible plan owes nothing here (its charge is worked out from the end date)', () => {
  assert.deepEqual(settleUpFee({ ...flex, balance: 30000, preGoLiveDeposits: 30000 }, R), { fee: 0, agent: 0, platform: 0 })
})

test('a flexible plan preview has no per-deposit fee', () => {
  assert.deepEqual(planFeePreview({ cadence: 'flexible', amountPerPayment: 0, totalSaved: 0, periodicFeePct: 7.5 }), { kind: 'flexible', total: 0 })
})

test('feeSentence for flexible names the commission and the penalty (cash) or only the penalty (online)', () => {
  const base = { live: true, cadence: 'flexible', amountPerPayment: 0, periodicFeePct: 7.5 }
  assert.equal(feeSentence({ ...base, flexible: { cashCommissionPct: 5, penaltyPct: 5, online: false } }), '5% is taken when they collect, plus 5% if they stop before the end date.')
  assert.equal(feeSentence({ ...base, flexible: { cashCommissionPct: 5, penaltyPct: 5, online: true } }), 'No charge if you keep it to the end date. Stopping early costs 5%.')
  assert.equal(feeSentence({ ...base, live: false, flexible: { cashCommissionPct: 5, penaltyPct: 5, online: true } }), 'No charge if you keep it to the end date. Stopping early costs 5%.')
})
