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

/** Amount to credit/charge for one cycle (one contribution, every cadence); 0 at/after maturity (D8). */
export function cycleCreditAmount(
  plan: { dailyAmount: number; cadence: string; maturityDate: Date },
  cycleDate: Date,
): number {
  if (cycleDate.getTime() >= plan.maturityDate.getTime()) return 0
  return money(plan.dailyAmount)
}
