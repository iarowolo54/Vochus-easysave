// Owner's rule (Nov 2026): one payment can't be more than the plan still has room for — the plan's
// amount for every day left until it ends. Weekly and monthly plans count whole weeks/months left, so a
// full cycle's payment near the end is never refused. Flexible plans have no set amount, so no cap.
// Pure and client-safe.

const DAY_MS = 24 * 60 * 60 * 1000
const CYCLE_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 }

type CapPlan = { dailyAmount: number; cadence: string; maturityDate: Date }

/** The most one payment into this plan may be right now; null when there is no cap (flexible plans). */
export function maxSinglePayment(plan: CapPlan, now: Date = new Date()): number | null {
  const cycleDays = CYCLE_DAYS[plan.cadence]
  if (!cycleDays || !(plan.dailyAmount > 0)) return null
  const daysLeft = Math.max(1, Math.ceil((plan.maturityDate.getTime() - now.getTime()) / DAY_MS))
  const cycles = Math.ceil(daysLeft / cycleDays)
  return Math.round(plan.dailyAmount * cycleDays * cycles * 100) / 100
}

/** The refusal shown when a payment is over the cap. */
export function overCapMessage(max: number): string {
  return `That’s more than this plan has left to save. The most you can pay into it now is ₦${max.toLocaleString('en-NG', { maximumFractionDigits: 2 })}.`
}
