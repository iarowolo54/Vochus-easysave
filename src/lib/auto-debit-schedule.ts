import { money } from '@/lib/wallet-guard'

export type AutoDebitCadence = 'daily' | 'weekly' | 'monthly'

const MS_PER_DAY = 86_400_000

/** Each plan cadence is debited on its own cadence (D7: daily plans are debited daily). */
export function autoDebitCadence(planCadence: string): AutoDebitCadence {
  if (planCadence === 'daily') return 'daily'
  if (planCadence === 'monthly') return 'monthly'
  return 'weekly'
}

// Same month-end-clamp approach as savings-interest.ts (private there), in UTC.
function addMonthsClamped(date: Date, k: number): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + k
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const day = Math.min(date.getUTCDate(), lastDay)
  return new Date(Date.UTC(y, m, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()))
}

/** Next run boundary strictly after `from`: +1 day, +7 days, or +1 month (day clamped). */
export function nextRunAt(from: Date, cadence: AutoDebitCadence): Date {
  if (cadence === 'monthly') return addMonthsClamped(from, 1)
  if (cadence === 'daily') return new Date(from.getTime() + MS_PER_DAY)
  return new Date(from.getTime() + 7 * MS_PER_DAY)
}

/**
 * The mandate's next boundary after a run, counted from the boundary it was due at, not from the moment the run
 * happened. A run a few seconds late used to push every later boundary a few seconds late too, so the next
 * morning's cron arrived just before it was due and skipped the day. Moves on past `now` so a cron that was
 * missed for a day doesn't charge twice to catch up.
 */
export function nextRunAfter(scheduled: Date, now: Date, cadence: AutoDebitCadence): Date {
  let next = nextRunAt(scheduled, cadence)
  while (next.getTime() <= now.getTime()) next = nextRunAt(next, cadence)
  return next
}

/**
 * Off by default. Weekly and monthly auto-debit has charged one day's amount per cycle (1/7 and 1/30 of the plan's
 * rate), while the app prices a week at 7 days and a month at 30 everywhere else (perSlotAmount, plan-dates).
 * Turning this on raises those customers' charges, so it stays off until the owner has decided how they are told:
 * set AUTO_DEBIT_FULL_CYCLE_AMOUNT=1 in the server's environment file and reload the app with --update-env.
 */
export const fullCycleAmountEnabled = () => process.env.AUTO_DEBIT_FULL_CYCLE_AMOUNT === '1'

const DAYS_PER_CYCLE: Record<AutoDebitCadence, number> = { daily: 1, weekly: 7, monthly: 30 }

/** What one cycle credits to the plan, and what the screen says will be charged. Daily is always one day. */
export function cycleAmount(plan: { dailyAmount: number; cadence: string }): number {
  const days = fullCycleAmountEnabled() ? DAYS_PER_CYCLE[autoDebitCadence(plan.cadence)] : 1
  return money(plan.dailyAmount * days)
}

/** Amount to credit/charge for one cycle (one contribution, every cadence); 0 at/after maturity (D8). */
export function cycleCreditAmount(
  plan: { dailyAmount: number; cadence: string; maturityDate: Date },
  cycleDate: Date,
): number {
  if (cycleDate.getTime() >= plan.maturityDate.getTime()) return 0
  return cycleAmount(plan)
}
