import { money } from '@/lib/money'
import { pct } from '@/lib/commission-rates'

/** The three Super Admin settings that decide every savings fee. All percent. */
export interface FeeRules {
  /** Daily plans: the agent's share of the first day's amount (the rest is the platform's). */
  dailyFirstAgentPct: number
  /** Weekly and monthly plans: the fee taken from each deposit. */
  periodicFeePct: number
  /** Weekly and monthly plans: the agent's share of that fee. */
  periodicAgentPct: number
}

export interface FeeSplit { fee: number; agent: number; platform: number }

const isDaily = (cadence: string | null) => !cadence || cadence === 'daily'

function split(fee: number, agentPct: number): FeeSplit {
  const f = money(fee)
  const agent = pct(f, agentPct)
  return { fee: f, agent, platform: money(f - agent) }
}

/**
 * The fee on one deposit to an offline plan. Daily plans give one day's amount (dailyAmount) to the platform and agent,
 * taken from the first deposit(s) until it has been collected; weekly and monthly plans take a percentage of each deposit.
 */
export function depositFee(i: { cadence: string | null; dailyAmount: number; feeCollected: number; deposit: number }, r: FeeRules): FeeSplit {
  if (isDaily(i.cadence)) {
    const owed = Math.max(0, i.dailyAmount - i.feeCollected)
    return split(Math.min(i.deposit, owed), r.dailyFirstAgentPct)
  }
  return split(pct(i.deposit, r.periodicFeePct), r.periodicAgentPct)
}

/** What is still owed at collection: anything the deposits did not already pay. Never negative, never more than the balance. */
export function settleUpFee(
  i: { cadence: string | null; dailyAmount: number; feeCollected: number; balance: number; preGoLiveDeposits: number },
  r: FeeRules,
): FeeSplit {
  if (isDaily(i.cadence)) {
    return split(Math.max(0, Math.min(i.dailyAmount - i.feeCollected, i.balance)), r.dailyFirstAgentPct)
  }
  const base = Math.max(0, Math.min(i.preGoLiveDeposits, i.balance))
  return split(pct(base, r.periodicFeePct), r.periodicAgentPct)
}

/** The fee line on a new plan's preview: the first day's amount (daily) or a percentage of everything saved. */
export function planFeePreview(i: { cadence: string | null; amountPerPayment: number; totalSaved: number; periodicFeePct: number }): { kind: 'first-day' | 'percent'; total: number } {
  if (isDaily(i.cadence)) return { kind: 'first-day', total: money(i.amountPerPayment) }
  return { kind: 'percent', total: pct(i.totalSaved, i.periodicFeePct) }
}

/** The one-line fee note shown while a plan is being set up. Before go-live it keeps today's wording. */
export function feeSentence(i: { live: boolean; cadence: string | null; amountPerPayment: number; periodicFeePct: number }): string {
  if (!i.live) return 'A platform fee is taken when they collect.'
  if (isDaily(i.cadence)) {
    return `The first day's savings (₦${money(i.amountPerPayment).toLocaleString('en-NG', { maximumFractionDigits: 2 })}) is the platform fee, taken from their first deposit.`
  }
  return `A platform fee of ${i.periodicFeePct}% is taken from each deposit.`
}
