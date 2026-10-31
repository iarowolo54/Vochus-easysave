// Turns a plan + its deposits into the "savings card": one slot per day (or per week for weekly
// plans), each saved / missed / today / upcoming. A deposit counts for the calendar day it's stamped
// with — bulk deposits are stamped with the day they cover — matching the agent's calendar.

export type SlotState = 'saved' | 'missed' | 'today' | 'upcoming'

export type Slot = {
  key: string      // YYYY-MM-DD of the day (or first day of the week)
  date: Date
  index: number    // 1-based day/week number within the plan
  state: SlotState
  coveredOnly: boolean // saved via a coverage marker (catch-up) with no deposit on that day/week
}

type PlanLike = { startDate: string; maturityDate: string; periodDays: number; cadence?: string }

/** Local-time YYYY-MM-DD (WAT on customers' phones), comparable as a string. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  out.setDate(out.getDate() + n)
  return out
}

export function isWeekly(plan: PlanLike): boolean {
  return (plan.cadence ?? 'daily') === 'weekly'
}

export function hasEnded(plan: PlanLike, now = new Date()): boolean {
  return dateKey(now) > dateKey(new Date(plan.maturityDate))
}

export function buildSlots(plan: PlanLike, depositDates: string[], coveredKeys: string[] = [], now = new Date()): Slot[] {
  const paid = new Set(depositDates.map(d => dateKey(new Date(d))))
  const covered = new Set(coveredKeys)
  const today = dateKey(now)
  const start = new Date(plan.startDate)

  if (!isWeekly(plan)) {
    return Array.from({ length: plan.periodDays }, (_, i) => {
      const date = addDays(start, i)
      const key = dateKey(date)
      const isPaid = paid.has(key)
      const isCovered = covered.has(key)
      const state: SlotState = isPaid || isCovered ? 'saved' : key < today ? 'missed' : key === today ? 'today' : 'upcoming'
      return { key, date, index: i + 1, state, coveredOnly: !isPaid && isCovered }
    })
  }

  const weeks = Math.ceil(plan.periodDays / 7)
  return Array.from({ length: weeks }, (_, w) => {
    const date = addDays(start, w * 7)
    const first = dateKey(date)
    const last = dateKey(addDays(start, w * 7 + 6))
    const hasDeposit = [...paid].some(k => k >= first && k <= last)
    const hasCover = [...covered].some(k => k >= first && k <= last)
    const saved = hasDeposit || hasCover
    const state: SlotState = saved ? 'saved' : last < today ? 'missed' : first <= today ? 'today' : 'upcoming'
    return { key: first, date, index: w + 1, state, coveredOnly: !hasDeposit && hasCover }
  })
}

/** Last day (YYYY-MM-DD) covered by a slot: the day itself, or the 7th day of a weekly slot. */
export function slotEndKey(slot: Slot, weekly: boolean): string {
  if (!weekly) return slot.key
  return dateKey(addDays(slot.date, 6))
}

/** Monday–Sunday of the calendar week containing `now`, as dates. */
export function currentWeekDays(now = new Date()): Date[] {
  const monday = addDays(now, -((now.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** Deposits grouped by the day they're stamped with. */
export function depositsByDay<T extends { createdAt: string }>(deposits: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const d of deposits) {
    const k = dateKey(new Date(d.createdAt))
    const list = map.get(k)
    if (list) list.push(d)
    else map.set(k, [d])
  }
  return map
}
