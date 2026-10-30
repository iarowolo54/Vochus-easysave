import { money } from '@/lib/wallet-guard'

export type AutoDebitCadence = 'weekly' | 'monthly'

const MS_PER_DAY = 86_400_000

/** Daily plans are batched to weekly debits (D7); weekly/monthly map to themselves. */
export function autoDebitCadence(planCadence: string): AutoDebitCadence {
  return planCadence === 'monthly' ? 'monthly' : 'weekly'
}

// Same month-end-clamp approach as savings-interest.ts (private there), in UTC.
function addMonthsClamped(date: Date, k: number): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + k
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const day = Math.min(date.getUTCDate(), lastDay)
  return new Date(Date.UTC(y, m, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()))
}

/** Next run boundary strictly after `from`: +7 days, or +1 month (day clamped). */
export function nextRunAt(from: Date, cadence: AutoDebitCadence): Date {
  if (cadence === 'monthly') return addMonthsClamped(from, 1)
  return new Date(from.getTime() + 7 * MS_PER_DAY)
}

/** Amount to credit/charge for one cycle; 0 at/after maturity (D8), final daily batch pro-rated. */
export function cycleCreditAmount(
  plan: { dailyAmount: number; cadence: string; maturityDate: Date },
  cycleDate: Date,
): number {
  if (cycleDate.getTime() >= plan.maturityDate.getTime()) return 0
  if (plan.cadence === 'daily') {
    const daysLeft = Math.floor((plan.maturityDate.getTime() - cycleDate.getTime()) / MS_PER_DAY)
    return money(plan.dailyAmount * Math.min(7, daysLeft))
  }
  return money(plan.dailyAmount)
}
