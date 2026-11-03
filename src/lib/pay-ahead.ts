// Pay-ahead rules for auto-debit: a cycle the customer already paid for through Bulk Savings is
// skipped, not charged. Coverage keys are WAT days, so cycle dates are read in WAT too; PM2 sets no
// TZ, and process-local dates would drift from the customer's calendar for an hour every night.
import { autoDebitCadence, cycleCreditAmount, nextRunAt } from '@/lib/auto-debit-schedule'
import { keyPlusDays, reachesSlotAmount, watKey } from '@/lib/savings-card'

type CyclePlan = { cadence: string; startDate: Date }
type RangePlan = CyclePlan & { periodDays: number }
type FundingPlan = CyclePlan & { dailyAmount: number }
type DepositAmount = { amount: number; createdAt: Date }

const MS_PER_DAY = 86_400_000

/**
 * How long an unpaid Bulk Savings checkout holds its days. Assumes a customer finishes or abandons Paystack's
 * checkout within about an hour. One who pays later is still credited; settlement then writes only the days free.
 */
export const PENDING_HOLD_MS = 60 * 60 * 1000

function daysIntoPlan(plan: CyclePlan, cycleDate: Date): number {
  return Math.round((Date.parse(watKey(cycleDate)) - Date.parse(watKey(plan.startDate))) / MS_PER_DAY)
}

/** Does this cycle fall on a day the plan has a slot for? Monthly plans have no slots, so they use the plain period. */
export function isCycleInPlan(plan: RangePlan, cycleDate: Date): boolean {
  const days = daysIntoPlan(plan, cycleDate)
  const length = plan.cadence === 'weekly' ? Math.ceil(plan.periodDays / 7) * 7 : plan.periodDays
  return days >= 0 && days < length
}

/** First and last WAT day of the slot holding `cycleDate`. Null for monthly, or a weekly cycle before the plan starts. */
function slotRange(plan: CyclePlan, cycleDate: Date): { first: string; last: string } | null {
  const day = watKey(cycleDate)
  if (plan.cadence === 'daily') return { first: day, last: day }
  if (plan.cadence !== 'weekly') return null
  // Weekly slots run from the plan start but cycles walk from mandate creation, so the two don't line up.
  const daysIn = daysIntoPlan(plan, cycleDate)
  if (daysIn < 0) return null
  const first = keyPlusDays(watKey(plan.startDate), daysIn - (daysIn % 7))
  return { first, last: keyPlusDays(first, 6) }
}

/** Has this auto-debit cycle already been paid for? Reads coverage only: a deposit doesn't say which days it paid for. */
export function isCycleCovered(plan: CyclePlan, coveredKeys: string[], cycleDate: Date): boolean {
  const range = slotRange(plan, cycleDate)
  if (!range) return false
  return coveredKeys.some(k => k >= range.first && k <= range.last)
}

/** The deposits that can fund a slot: not coverage payments, which count for the days they cover. */
export function ordinaryDeposits<T extends { ref: string }>(deposits: T[], coveringRefs: string[]): T[] {
  const covering = new Set(coveringRefs)
  return deposits.filter(d => !covering.has(d.ref))
}

/** Have deposits in this cycle's slot already reached that slot's plan amount? The same rule as the calendar. */
export function isSlotFunded(plan: FundingPlan, deposits: DepositAmount[], cycleDate: Date): boolean {
  const range = slotRange(plan, cycleDate)
  if (!range) return false
  const paid = deposits.reduce((sum, d) => {
    const key = watKey(d.createdAt)
    return key >= range.first && key <= range.last ? sum + d.amount : sum
  }, 0)
  return reachesSlotAmount(plan, paid)
}

/** The slot keys being charged right now, so a customer can't pay for one by hand at the same moment. */
export function inFlightKeys(plan: CyclePlan, attempts: { cycleDate: Date }[]): string[] {
  return attempts.flatMap(a => slotRange(plan, a.cycleDate)?.first ?? [])
}

/**
 * The next date auto-debit will really charge: from the next run, past cycles already paid for, stopping
 * at the end of the plan. Null if no charge is left. An overdue run is judged on `now`, the day the cron will
 * charge it.
 */
export function nextPaymentDate(input: {
  plan: RangePlan & FundingPlan & { status: string; maturityDate: Date }
  nextRunAt: Date
  coveredKeys: string[]
  plainDeposits?: DepositAmount[]
  now: Date
}): Date | null {
  const { plan, coveredKeys, plainDeposits = [], now } = input
  if (plan.status !== 'Active') return null
  const cadence = autoDebitCadence(plan.cadence)
  let cycle = input.nextRunAt.getTime() < now.getTime() ? now : input.nextRunAt
  while (cycleCreditAmount(plan, cycle) > 0) {
    if (isCycleInPlan(plan, cycle)) {
      if (!isCycleCovered(plan, coveredKeys, cycle) && !isSlotFunded(plan, plainDeposits, cycle)) return cycle
    } else if (daysIntoPlan(plan, cycle) >= 0) {
      return null
    }
    cycle = nextRunAt(cycle, cadence)
  }
  return null
}
