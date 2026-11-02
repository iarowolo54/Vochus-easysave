// Pay-ahead rules for auto-debit: a cycle the customer already paid for through Bulk Savings is
// skipped, not charged. Coverage keys are WAT days, so cycle dates are read in WAT too; PM2 sets no
// TZ, and process-local dates would drift from the customer's calendar for an hour every night.
import { autoDebitCadence, cycleCreditAmount, nextRunAt } from '@/lib/auto-debit-schedule'
import { keyPlusDays, watKey } from '@/lib/savings-card'

type CyclePlan = { cadence: string; startDate: Date }

const MS_PER_DAY = 86_400_000

/** First and last WAT day of the slot holding `cycleDate`. Null for monthly, or a weekly cycle before the plan starts. */
function slotRange(plan: CyclePlan, cycleDate: Date): { first: string; last: string } | null {
  const day = watKey(cycleDate)
  if (plan.cadence === 'daily') return { first: day, last: day }
  if (plan.cadence !== 'weekly') return null
  // Weekly slots run from the plan start but cycles walk from mandate creation, so the two don't line up.
  const start = watKey(plan.startDate)
  const daysIn = Math.round((Date.parse(day) - Date.parse(start)) / MS_PER_DAY)
  if (daysIn < 0) return null
  const first = keyPlusDays(start, daysIn - (daysIn % 7))
  return { first, last: keyPlusDays(first, 6) }
}

/** Has this auto-debit cycle already been paid for? Reads coverage only: a deposit doesn't say which days it paid for. */
export function isCycleCovered(plan: CyclePlan, coveredKeys: string[], cycleDate: Date): boolean {
  const range = slotRange(plan, cycleDate)
  if (!range) return false
  return coveredKeys.some(k => k >= range.first && k <= range.last)
}

/** The slot keys being charged right now, so a customer can't pay for one by hand at the same moment. */
export function inFlightKeys(plan: CyclePlan, attempts: { cycleDate: Date }[]): string[] {
  return attempts.flatMap(a => slotRange(plan, a.cycleDate)?.first ?? [])
}

/**
 * The next date auto-debit will really charge: from the next run, past covered cycles, stopping at
 * maturity. Null if no charge is left. An overdue run is judged on `now`, the day the cron will charge it.
 */
export function nextPaymentDate(input: {
  plan: CyclePlan & { status: string; dailyAmount: number; maturityDate: Date }
  nextRunAt: Date
  coveredKeys: string[]
  now: Date
}): Date | null {
  const { plan, coveredKeys, now } = input
  if (plan.status !== 'Active') return null
  const cadence = autoDebitCadence(plan.cadence)
  let cycle = input.nextRunAt.getTime() < now.getTime() ? now : input.nextRunAt
  while (cycleCreditAmount(plan, cycle) > 0) {
    if (!isCycleCovered(plan, coveredKeys, cycle)) return cycle
    cycle = nextRunAt(cycle, cadence)
  }
  return null
}
