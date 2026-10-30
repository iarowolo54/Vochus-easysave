import { money } from '@/lib/wallet-guard'

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

const MS_PER_DAY = 86_400_000

export type InterestProjection = { daysToNextInterest: number; nextInterestAmount: number }

/**
 * Forward-looking nudge for the NEXT interest credit: the whole days until the plan's next
 * monthly anniversary (month-end clamped, same as accrual) and the credit it will earn at that
 * date — `balance x rate-in-effect-then / 12`. A floor that grows as the customer keeps saving.
 * Returns null when the plan has matured or has no further anniversary before maturity.
 */
export function interestProjection(input: {
  startDate: Date
  maturityDate: Date
  balance: number
  asOf: Date
  rateSchedule: RateEntry[]
}): InterestProjection | null {
  if (!Number.isFinite(input.startDate.getTime()) || !Number.isFinite(input.maturityDate.getTime())) return null
  if (input.asOf.getTime() >= input.maturityDate.getTime()) return null
  let anniversary: Date = input.maturityDate
  for (let k = 1; ; k++) {
    const a = addMonthsClamped(input.startDate, k)
    if (a.getTime() > input.asOf.getTime()) { anniversary = a; break }
  }
  if (anniversary.getTime() > input.maturityDate.getTime()) return null
  const daysToNextInterest = Math.ceil((anniversary.getTime() - input.asOf.getTime()) / MS_PER_DAY)
  const nextInterestAmount = money(input.balance * (rateOn(input.rateSchedule, anniversary) / 12 / 100))
  return { daysToNextInterest, nextInterestAmount }
}
