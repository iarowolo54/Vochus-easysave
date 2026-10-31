// Pure month-grid logic for the in-page date picker (UI in src/components/ui/DatePicker.tsx).
// Monday-first weeks. All comparisons are at local midnight via the shared ISO helpers, so there
// is no UTC drift. Reusable: pass minIso/maxIso to bound it (plan start = today..∞, DOB = ..today).

import { isoDate, parseDateInput } from './plan-dates'

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
/** Monday-first weekday headers. */
export const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

export interface DayCell {
  iso: string
  day: number
  isToday: boolean
  isSelected: boolean
  disabled: boolean
}
export interface MonthView {
  year: number
  month: number // 0-11
  title: string // "November 2026"
  leadingBlanks: number // empty slots before day 1 (Monday-first)
  days: DayCell[]
}

const sameIso = (a: Date, b: Date) => isoDate(a) === isoDate(b)

/** Monday-first offset for the 1st of the month (Mon=0 … Sun=6). */
export function leadingBlanks(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function outOfRange(d: Date, min: Date | null, max: Date | null): boolean {
  if (min && d < min) return true
  if (max && d > max) return true
  return false
}

export function monthView(
  year: number,
  month: number,
  opts: { today: Date; selectedIso?: string | null; minIso?: string | null; maxIso?: string | null },
): MonthView {
  const min = opts.minIso ? parseDateInput(opts.minIso) : null
  const max = opts.maxIso ? parseDateInput(opts.maxIso) : null
  const sel = opts.selectedIso ? parseDateInput(opts.selectedIso) : null
  const count = daysInMonth(year, month)
  const days: DayCell[] = []
  for (let d = 1; d <= count; d++) {
    const date = new Date(year, month, d)
    days.push({
      iso: isoDate(date),
      day: d,
      isToday: sameIso(date, opts.today),
      isSelected: !!sel && sameIso(date, sel),
      disabled: outOfRange(date, min, max),
    })
  }
  return {
    year,
    month,
    title: `${MONTH_NAMES[month]} ${year}`,
    leadingBlanks: leadingBlanks(year, month),
    days,
  }
}

/** Is an ISO date within [min, max]? Used to guard the confirm action and the "Today" shortcut. */
export function isSelectable(iso: string, minIso?: string | null, maxIso?: string | null): boolean {
  const d = parseDateInput(iso)
  if (!d) return false
  const min = minIso ? parseDateInput(minIso) : null
  const max = maxIso ? parseDateInput(maxIso) : null
  if (min && d < min) return false
  if (max && d > max) return false
  return true
}

/** Can the view step to the previous month without crossing below min? */
export function canGoPrev(year: number, month: number, minIso?: string | null): boolean {
  const min = minIso ? parseDateInput(minIso) : null
  if (!min) return true
  // The last day of the previous month must still be >= min.
  const prevMonthEnd = new Date(year, month, 0)
  return prevMonthEnd >= min
}

/** Can the view step to the next month without crossing above max? */
export function canGoNext(year: number, month: number, maxIso?: string | null): boolean {
  const max = maxIso ? parseDateInput(maxIso) : null
  if (!max) return true
  const nextMonthStart = new Date(year, month + 1, 1)
  return nextMonthStart <= max
}

/** Step a {year,month} by ±1 month, normalising December/January. */
export function stepMonth(year: number, month: number, dir: 1 | -1): { year: number; month: number } {
  const d = new Date(year, month + dir, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

/** The month a picker should open on: the selected date clamped into [min,max], else today clamped. */
export function initialView(opts: { today: Date; selectedIso?: string | null; minIso?: string | null; maxIso?: string | null }): { year: number; month: number } {
  const min = opts.minIso ? parseDateInput(opts.minIso) : null
  const max = opts.maxIso ? parseDateInput(opts.maxIso) : null
  let d = (opts.selectedIso && parseDateInput(opts.selectedIso)) || opts.today
  if (min && d < min) d = min
  if (max && d > max) d = max
  return { year: d.getFullYear(), month: d.getMonth() }
}
