// Plan dates. Every plan API stores `maturityDate = startDate + periodDays`, so a chosen end date is sent as a
// number of days. Weekly and monthly plans run in whole weeks (7 days) or months (30 days), matching the APIs.

export type Cadence = 'daily' | 'weekly' | 'monthly'

export const UNIT_DAYS: Record<Cadence, number> = { daily: 1, weekly: 7, monthly: 30 }
const UNIT_NAME: Record<Cadence, [string, string]> = { daily: ['day', 'days'], weekly: ['week', 'weeks'], monthly: ['month', 'months'] }

/** Local midnight today. */
export function today(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** "2026-12-29" for <input type="date">, in local time (toISOString would shift it to UTC). */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Reads an <input type="date"> value as local midnight; null when empty or invalid. */
export function parseDateInput(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return isNaN(d.getTime()) ? null : d
}

export function addDays(from: Date, days: number): Date {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  return d
}

/** Whole days from one date to another, ignoring the time of day and clock changes. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86400000)
}

/** Rounds a length in days to whole weeks or months for those plans; never less than one unit. */
export function snapDays(days: number, cadence: Cadence): number {
  const u = UNIT_DAYS[cadence]
  return Math.max(u, Math.round(days / u) * u)
}

/** "62 days", "9 weeks", "1 month". */
export function lengthLabel(days: number, cadence: Cadence): string {
  const n = Math.round(days / UNIT_DAYS[cadence])
  return `${n} ${UNIT_NAME[cadence][n === 1 ? 0 : 1]}`
}

/** The longest plan anyone can pick: 5 years. */
export const MAX_PLAN_DAYS = 365 * 5
