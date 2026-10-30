import type { PrismaClient } from '@prisma/client'
import { money } from '@/lib/wallet-guard'
import { getSavingsRateSchedule } from '@/lib/savings-interest-rate'

export const DEFAULT_ANNUAL_RATE = 12

export type RateEntry = { effectiveFrom: Date; annualRate: number }

/** Annual rate in effect on `date`: latest entry with effectiveFrom <= date, else the default. */
export function rateOn(schedule: RateEntry[], date: Date): number {
  let best: RateEntry | null = null
  for (const e of schedule) {
    if (e.effectiveFrom.getTime() <= date.getTime()) {
      if (!best || e.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = e
    }
  }
  return best ? best.annualRate : DEFAULT_ANNUAL_RATE
}

/** date + k months (UTC), day-of-month clamped to the target month's last day. Always computed from the original date. */
function addMonthsClamped(date: Date, k: number): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + k
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const day = Math.min(date.getUTCDate(), lastDay)
  return new Date(Date.UTC(y, m, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()))
}

/**
 * Simple (non-compounding) interest accrued on completed monthly anniversaries up to
 * min(asOf, maturityDate). Each month earns at the rate in effect on its anniversary.
 */
export function accruedInterest(input: {
  startDate: Date
  maturityDate: Date
  deposits: { amount: number; createdAt: Date }[]
  asOf: Date
  rateSchedule: RateEntry[]
}): number {
  const cutoff = Math.min(input.asOf.getTime(), input.maturityDate.getTime())
  let total = 0
  for (let k = 1; ; k++) {
    const a = addMonthsClamped(input.startDate, k)
    if (a.getTime() > cutoff) break
    const principal = input.deposits.reduce(
      (s, dep) => (dep.createdAt.getTime() <= a.getTime() ? s + dep.amount : s),
      0,
    )
    total += money(principal * (rateOn(input.rateSchedule, a) / 12 / 100))
  }
  return money(total)
}

type PlanClient = Pick<PrismaClient, 'transaction' | 'savingsInterestRate'>

/**
 * Interest accrued on a plan. Only self-service plans earn interest; offline/agent
 * plans return 0 without touching the DB. Reads only amount + createdAt of the
 * plan's completed `saving` deposits.
 */
export async function accruedInterestForPlan(
  client: PlanClient,
  plan: { id: string; source: string; startDate: Date; maturityDate: Date },
  asOf: Date,
): Promise<number> {
  if (plan.source !== 'self') return 0
  const [deposits, rateSchedule] = await Promise.all([
    client.transaction.findMany({
      where: { planId: plan.id, type: 'saving', status: 'Done' },
      select: { amount: true, createdAt: true },
    }),
    getSavingsRateSchedule(client),
  ])
  return accruedInterest({ startDate: plan.startDate, maturityDate: plan.maturityDate, deposits, asOf, rateSchedule })
}
