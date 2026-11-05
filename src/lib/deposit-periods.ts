/** Deposit totals for today / this week (Monday) / this month, with the same stretch of the period before.
 *  Days are Africa/Lagos (WAT, fixed UTC+1). `amount` is the full deposit; `feeTaken` came out of it. */
const WAT_MS = 60 * 60 * 1000
const DAY_MS = 24 * WAT_MS

export type DepositRow = { createdAt: Date; amount: number; feeTaken: number }
export type PeriodTotals = { total: number; count: number; fees: number; prevTotal: number }
export type SeriesPoint = { day: number; thisMonth: number | null; lastMonth: number | null }

export function depositPeriodStarts(now: Date = new Date()): { day: Date; week: Date; month: Date; prevMonth: Date } {
  const wat = new Date(now.getTime() + WAT_MS) // read the UTC fields of this as WAT wall-clock
  const y = wat.getUTCFullYear()
  const m = wat.getUTCMonth()
  const d = wat.getUTCDate()
  const sinceMonday = (wat.getUTCDay() + 6) % 7
  const at = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd) - WAT_MS)
  return { day: at(y, m, d), week: at(y, m, d - sinceMonday), month: at(y, m, 1), prevMonth: at(y, m - 1, 1) }
}

const round = (n: number) => Math.round(n)

export function summariseDeposits(rows: DepositRow[], now: Date = new Date()) {
  const s = depositPeriodStarts(now)
  const t = now.getTime()
  // Each period against the same stretch of the one before (this week so far vs the same days last week).
  const windows = {
    day: { start: s.day.getTime(), prevStart: s.day.getTime() - DAY_MS },
    week: { start: s.week.getTime(), prevStart: s.week.getTime() - 7 * DAY_MS },
    month: { start: s.month.getTime(), prevStart: s.prevMonth.getTime() },
  }
  const out = {} as Record<'day' | 'week' | 'month', PeriodTotals>
  for (const k of ['day', 'week', 'month'] as const) {
    const w = windows[k]
    const prevEnd = Math.min(w.prevStart + (t - w.start), w.start)
    let total = 0, count = 0, fees = 0, prevTotal = 0
    for (const r of rows) {
      const at = r.createdAt.getTime()
      if (at >= w.start && at <= t) { total += r.amount; fees += r.feeTaken; count++ }
      else if (at >= w.prevStart && at < prevEnd) prevTotal += r.amount
    }
    out[k] = { total: round(total), count, fees: round(fees), prevTotal: round(prevTotal) }
  }

  // Running total through the month, this month against last.
  const wat = new Date(t + WAT_MS)
  const y = wat.getUTCFullYear(), m = wat.getUTCMonth(), today = wat.getUTCDate()
  const daysThis = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const daysLast = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cur = new Array<number>(daysThis).fill(0)
  const prev = new Array<number>(daysLast).fill(0)
  const lastMonthIdx = Date.UTC(y, m - 1, 1)
  for (const r of rows) {
    const w = new Date(r.createdAt.getTime() + WAT_MS)
    const idx = Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), 1)
    if (idx === Date.UTC(y, m, 1)) cur[w.getUTCDate() - 1] += r.amount
    else if (idx === lastMonthIdx) prev[w.getUTCDate() - 1] += r.amount
  }
  const series: SeriesPoint[] = []
  let a = 0, b = 0
  for (let day = 1; day <= Math.max(daysThis, daysLast); day++) {
    if (day <= daysThis) a += cur[day - 1]
    if (day <= daysLast) b += prev[day - 1]
    series.push({ day, thisMonth: day <= today ? round(a) : null, lastMonth: day <= daysLast ? round(b) : null })
  }
  return { ...out, series }
}
