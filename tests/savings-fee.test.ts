// Unit test: the new savings fee rules (offline daily first-day amount, weekly/monthly deposit fee) and their splits.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calendarMonthsSpanned, depositFee, feeSentence, monthsSavedIn, planFeePreview, settleUpFee, watMonthKey, type FeeRules } from '../src/lib/savings-fee'

const R: FeeRules = { dailyFirstAgentPct: 60, periodicFeePct: 7.5, periodicAgentPct: 60 }
const daily = (feePaid: number, deposit: number, dailyAmount = 500, monthsSaved = 1) => ({ cadence: 'daily', dailyAmount, monthsSaved, feePaid, deposit })

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
  assert.equal(depositFee({ cadence: null, dailyAmount: 500, monthsSaved: 1, feePaid: 0, deposit: 500 }, R).fee, 500)
})

test('weekly and monthly take the percentage of each deposit, and the shares add up to the fee', () => {
  const w = depositFee({ cadence: 'weekly', dailyAmount: 1000, monthsSaved: 1, feePaid: 0, deposit: 1001 }, R)
  assert.equal(w.fee, 75.08)
  assert.equal(w.agent + w.platform, w.fee)
  assert.equal(depositFee({ cadence: 'monthly', dailyAmount: 1000, monthsSaved: 1, feePaid: 0, deposit: 1000 }, R).fee, 75)
})

test('a fee rate of 0 takes nothing', () => {
  assert.equal(depositFee({ cadence: 'weekly', dailyAmount: 1000, monthsSaved: 1, feePaid: 0, deposit: 1000 }, { ...R, periodicFeePct: 0 }).fee, 0)
})

test('settle-up on a daily plan collects one day for each month saved in, less what was paid, capped at the balance', () => {
  const base = { cadence: 'daily', dailyAmount: 500, preGoLiveDeposits: 0 }
  assert.equal(settleUpFee({ ...base, monthsSaved: 1, feePaid: 0, balance: 5000 }, R).fee, 500)
  assert.equal(settleUpFee({ ...base, monthsSaved: 1, feePaid: 0, balance: 300 }, R).fee, 300)
  assert.equal(settleUpFee({ ...base, monthsSaved: 1, feePaid: 500, balance: 5000 }, R).fee, 0)
  assert.deepEqual(settleUpFee({ ...base, monthsSaved: 3, feePaid: 700, balance: 20000 }, R), { fee: 800, agent: 480, platform: 320 })
  assert.equal(settleUpFee({ ...base, monthsSaved: 0, feePaid: 0, balance: 5000 }, R).fee, 0)
})

test('a new month owes a fresh day even after an earlier month paid', () => {
  assert.equal(depositFee(daily(500, 500, 500, 2), R).fee, 500)
  assert.equal(depositFee(daily(1000, 500, 500, 2), R).fee, 0)
})

test('an earlier unpaid month is taken straight away from the next saving, with this month\'s', () => {
  // October saved but never charged, November paid: the first December saving of 1,500 pays October and December.
  assert.deepEqual(depositFee(daily(500, 1500, 500, 3), R), { fee: 1000, agent: 600, platform: 400 })
  // A smaller saving is all fee; the rest comes from the next one.
  assert.equal(depositFee(daily(500, 600, 500, 3), R).fee, 600)
  assert.equal(depositFee(daily(1100, 600, 500, 3), R).fee, 400)
})

test('calendar months are Lagos months, whatever their length', () => {
  // 31 Jan 23:30 UTC is already 1 Feb in Lagos.
  assert.equal(watMonthKey(new Date('2026-01-31T23:30:00Z')), '2026-02')
  assert.equal(watMonthKey(new Date('2026-01-31T22:59:00Z')), '2026-01')
  assert.equal(watMonthKey(new Date('2028-02-29T12:00:00Z')), '2028-02')
})

test('months saved in counts each calendar month once; months with no saving are not counted', () => {
  const d = (iso: string) => new Date(iso)
  assert.equal(monthsSavedIn([d('2026-10-20T12:00:00Z'), d('2026-10-21T12:00:00Z'), d('2026-12-01T12:00:00Z'), d('2026-12-31T12:00:00Z')]), 2)
  assert.equal(monthsSavedIn([]), 0)
})

test('a plan from 28 Nov for 35 days runs in three calendar months; a 30-day plan from 1 Sep in one', () => {
  assert.equal(calendarMonthsSpanned(new Date('2026-11-28T12:00:00Z'), 35), 3)
  assert.equal(calendarMonthsSpanned(new Date('2026-09-01T12:00:00Z'), 30), 1)
  assert.equal(calendarMonthsSpanned(new Date('2026-12-15T12:00:00Z'), 365), 13)
  assert.equal(calendarMonthsSpanned(new Date('2026-12-15T12:00:00Z'), 0), 0)
})

test('settle-up on a weekly plan is the percentage of the older deposits still in the balance', () => {
  const base = { cadence: 'weekly', dailyAmount: 1000, monthsSaved: 0, feePaid: 0 }
  assert.equal(settleUpFee({ ...base, balance: 30000, preGoLiveDeposits: 40000 }, R).fee, 2250)
  assert.equal(settleUpFee({ ...base, balance: 30000, preGoLiveDeposits: 0 }, R).fee, 0)
})

test('plan previews: daily shows one day per calendar month, weekly the percentage of the total', () => {
  assert.deepEqual(planFeePreview({ cadence: 'daily', amountPerPayment: 500, totalSaved: 45000, periodicFeePct: 7.5, months: 4 }), { kind: 'first-day', total: 2000 })
  assert.deepEqual(planFeePreview({ cadence: 'weekly', amountPerPayment: 10000, totalSaved: 100000, periodicFeePct: 7.5, months: 3 }), { kind: 'percent', total: 7500 })
})

test('feeSentence says what the old rule says before go-live', () => {
  assert.equal(feeSentence({ live: false, cadence: 'daily', amountPerPayment: 500, periodicFeePct: 7.5 }), 'A platform fee is taken when they redeem.')
})

test('feeSentence for a live daily plan names one day\'s amount each month', () => {
  assert.equal(feeSentence({ live: true, cadence: 'daily', amountPerPayment: 500, periodicFeePct: 7.5 }), 'One day\'s savings (₦500) each month is the platform fee, taken from the first saving of every month.')
})

test('feeSentence for a live weekly or monthly plan names the percentage', () => {
  assert.equal(feeSentence({ live: true, cadence: 'weekly', amountPerPayment: 10000, periodicFeePct: 7.5 }), 'A platform fee of 7.5% is taken from each deposit.')
  assert.equal(feeSentence({ live: true, cadence: 'monthly', amountPerPayment: 10000, periodicFeePct: 5 }), 'A platform fee of 5% is taken from each deposit.')
})

const flex = { cadence: 'flexible', dailyAmount: 0, monthsSaved: 0, feePaid: 0 }

test('a flexible deposit takes no fee, even though it is not daily', () => {
  assert.deepEqual(depositFee({ ...flex, deposit: 2000 }, R), { fee: 0, agent: 0, platform: 0 })
})

test('settle-up on a flexible plan owes nothing here (its charge is worked out from the end date)', () => {
  assert.deepEqual(settleUpFee({ ...flex, balance: 30000, preGoLiveDeposits: 30000 }, R), { fee: 0, agent: 0, platform: 0 })
})

test('a flexible plan preview has no per-deposit fee', () => {
  assert.deepEqual(planFeePreview({ cadence: 'flexible', amountPerPayment: 0, totalSaved: 0, periodicFeePct: 7.5, months: 1 }), { kind: 'flexible', total: 0 })
})

test('feeSentence for flexible names the commission and the penalty (cash) or only the penalty (online)', () => {
  const base = { live: true, cadence: 'flexible', amountPerPayment: 0, periodicFeePct: 7.5 }
  assert.equal(feeSentence({ ...base, flexible: { cashCommissionPct: 5, penaltyPct: 5, online: false } }), '5% is taken when they redeem, plus 5% if they stop before the end date.')
  assert.equal(feeSentence({ ...base, flexible: { cashCommissionPct: 5, penaltyPct: 5, online: true } }), 'No charge if you keep it to the end date. Stopping early costs 5%.')
  assert.equal(feeSentence({ ...base, live: false, flexible: { cashCommissionPct: 5, penaltyPct: 5, online: true } }), 'No charge if you keep it to the end date. Stopping early costs 5%.')
})
