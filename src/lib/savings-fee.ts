import { money } from '@/lib/money'
import { pct } from '@/lib/commission-rates'
import { isFlexible } from '@/lib/flexible-savings'

/** The three Super Admin settings that decide every savings fee. All percent. */
export interface FeeRules {
  /** Daily plans: the agent's share of each month's one-day fee (the rest is the platform's). */
  dailyFirstAgentPct: number
  /** Weekly and monthly plans: the fee taken from each deposit. */
  periodicFeePct: number
  /** Weekly and monthly plans: the agent's share of that fee. */
  periodicAgentPct: number
}

export interface FeeSplit { fee: number; agent: number; platform: number }

const isDaily = (cadence: string | null) => !cadence || cadence === 'daily'
const NONE: FeeSplit = { fee: 0, agent: 0, platform: 0 }

// Months are Lagos calendar months (WAT, fixed UTC+1), whatever their length.
const WAT_MS = 3_600_000

/** The calendar month a moment falls in, in Lagos time, as 'YYYY-MM'. */
export function watMonthKey(d: Date): string {
  return new Date(d.getTime() + WAT_MS).toISOString().slice(0, 7)
}

/** How many different calendar months these days fall in. A month with no saving is not counted, so it owes nothing. */
export function monthsSavedIn(days: Date[]): number {
  return new Set(days.map(watMonthKey)).size
}

/** How many calendar months a plan's days touch: a plan from 28 Nov for 35 days runs in Nov, Dec and Jan. */
export function calendarMonthsSpanned(start: Date, days: number): number {
  if (days <= 0) return 0
  const last = new Date(start.getTime() + (days - 1) * 86_400_000)
  const [y1, m1] = watMonthKey(start).split('-').map(Number)
  const [y2, m2] = watMonthKey(last).split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1) + 1
}

function split(fee: number, agentPct: number): FeeSplit {
  const f = money(fee)
  const agent = pct(f, agentPct)
  return { fee: f, agent, platform: money(f - agent) }
}

/** Daily plans: one day's amount for every calendar month saved in, less what has already been paid. Never negative. */
function dailyOwed(dailyAmount: number, monthsSaved: number, feePaid: number): number {
  return Math.max(0, dailyAmount * monthsSaved - feePaid)
}

/**
 * The fee on one deposit to an offline plan. Daily plans give one day's amount (dailyAmount) to the platform and agent
 * for every calendar month the plan has a saving in (monthsSaved, counting this deposit's month), taken from the next
 * saving(s) until it has been paid, so a month left unpaid earlier is caught up straight away (feePaid = what the plan's
 * savings already paid); weekly and monthly plans take a percentage of each deposit.
 */
export function depositFee(i: { cadence: string | null; dailyAmount: number; monthsSaved: number; feePaid: number; deposit: number }, r: FeeRules): FeeSplit {
  // Flexible plans pay nothing per deposit; their charge is taken at collection (flexibleDeduction).
  if (isFlexible(i.cadence)) return { ...NONE }
  if (isDaily(i.cadence)) {
    return split(Math.min(i.deposit, dailyOwed(i.dailyAmount, i.monthsSaved, i.feePaid)), r.dailyFirstAgentPct)
  }
  return split(pct(i.deposit, r.periodicFeePct), r.periodicAgentPct)
}

/**
 * What is still owed at collection: anything the deposits did not already pay. Never negative, never more than the balance.
 * Daily plans: one day's amount for every calendar month with a saving, less what the savings already paid.
 */
export function settleUpFee(
  i: { cadence: string | null; dailyAmount: number; monthsSaved: number; feePaid: number; balance: number; preGoLiveDeposits: number },
  r: FeeRules,
): FeeSplit {
  if (isFlexible(i.cadence)) return { ...NONE }
  if (isDaily(i.cadence)) {
    return split(Math.max(0, Math.min(dailyOwed(i.dailyAmount, i.monthsSaved, i.feePaid), i.balance)), r.dailyFirstAgentPct)
  }
  const base = Math.max(0, Math.min(i.preGoLiveDeposits, i.balance))
  return split(pct(base, r.periodicFeePct), r.periodicAgentPct)
}

/**
 * The fee line on a new plan's preview: one day's amount for each calendar month the plan runs in (daily, assuming they
 * save every month) or a percentage of everything saved.
 */
export function planFeePreview(i: { cadence: string | null; amountPerPayment: number; totalSaved: number; periodicFeePct: number; months: number }): { kind: 'first-day' | 'percent' | 'flexible'; total: number } {
  if (isFlexible(i.cadence)) return { kind: 'flexible', total: 0 }
  if (isDaily(i.cadence)) return { kind: 'first-day', total: money(i.amountPerPayment * Math.max(1, i.months)) }
  return { kind: 'percent', total: pct(i.totalSaved, i.periodicFeePct) }
}

/** The one-line fee note shown while a plan is being set up. Before go-live it keeps today's wording. */
export function feeSentence(i: {
  live: boolean; cadence: string | null; amountPerPayment: number; periodicFeePct: number
  flexible?: { cashCommissionPct: number; penaltyPct: number; online: boolean }
}): string {
  // Flexible is new, so it has no "before go-live" wording.
  if (isFlexible(i.cadence) && i.flexible) {
    const f = i.flexible
    return f.online
      ? `No charge if you keep it to the end date. Stopping early costs ${f.penaltyPct}%.`
      : `${f.cashCommissionPct}% is taken when they redeem, plus ${f.penaltyPct}% if they stop before the end date.`
  }
  if (!i.live) return 'A platform fee is taken when they redeem.'
  if (isDaily(i.cadence)) {
    return `One day's savings (₦${money(i.amountPerPayment).toLocaleString('en-NG', { maximumFractionDigits: 2 })}) each month is the platform fee, taken from the first saving of every month.`
  }
  return `A platform fee of ${i.periodicFeePct}% is taken from each deposit.`
}
