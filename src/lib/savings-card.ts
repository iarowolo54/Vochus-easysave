// Turns a plan + its deposits into the "savings card": one slot per day (or per week for weekly
// plans), each saved / missed / today / upcoming. A deposit counts for the calendar day it's stamped
// with — bulk deposits are stamped with the day they cover — matching the agent's calendar.

export type SlotState = 'saved' | 'missed' | 'today' | 'upcoming'

export type Slot = {
  key: string      // YYYY-MM-DD of the day (or first day of the week)
  date: Date
  index: number    // 1-based day/week number within the plan
  state: SlotState
  coveredOnly: boolean // saved via a coverage marker (Bulk Savings) with no deposit on that day/week
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

/** YYYY-MM-DD in Africa/Lagos whatever the process timezone. WAT is a fixed UTC+1 with no DST. */
export function watKey(d: Date): string {
  return new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10)
}

/** The YYYY-MM-DD `n` days after `key`. Calendar arithmetic only, so independent of timezone. */
export function keyPlusDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function localMidnight(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function watMidnight(key: string): Date {
  return new Date(`${key}T00:00:00+01:00`)
}

function slotsFor(
  plan: PlanLike, depositDates: string[], coveredKeys: string[], now: Date,
  keyOf: (d: Date) => string, dateOf: (key: string) => Date,
): Slot[] {
  const paid = new Set(depositDates.map(d => keyOf(new Date(d))))
  const covered = new Set(coveredKeys)
  const today = keyOf(now)
  const startKey = keyOf(new Date(plan.startDate))

  if (!isWeekly(plan)) {
    return Array.from({ length: plan.periodDays }, (_, i) => {
      const key = keyPlusDays(startKey, i)
      const isPaid = paid.has(key)
      const isCovered = covered.has(key)
      const state: SlotState = isPaid || isCovered ? 'saved' : key < today ? 'missed' : key === today ? 'today' : 'upcoming'
      return { key, date: dateOf(key), index: i + 1, state, coveredOnly: !isPaid && isCovered }
    })
  }

  const weeks = Math.ceil(plan.periodDays / 7)
  return Array.from({ length: weeks }, (_, w) => {
    const first = keyPlusDays(startKey, w * 7)
    const last = keyPlusDays(startKey, w * 7 + 6)
    const hasDeposit = [...paid].some(k => k >= first && k <= last)
    const hasCover = [...covered].some(k => k >= first && k <= last)
    const saved = hasDeposit || hasCover
    const state: SlotState = saved ? 'saved' : last < today ? 'missed' : first <= today ? 'today' : 'upcoming'
    return { key: first, date: dateOf(first), index: w + 1, state, coveredOnly: !hasDeposit && hasCover }
  })
}

export function buildSlots(plan: PlanLike, depositDates: string[], coveredKeys: string[] = [], now = new Date()): Slot[] {
  return slotsFor(plan, depositDates, coveredKeys, now, dateKey, localMidnight)
}

/** buildSlots for the server: PM2 sets no TZ, so slot days must be pinned to WAT, where customers' phones are. */
export function buildSlotsWat(plan: PlanLike, depositDates: string[], coveredKeys: string[] = [], now = new Date()): Slot[] {
  return slotsFor(plan, depositDates, coveredKeys, now, watKey, watMidnight)
}

/** Last day (YYYY-MM-DD) covered by a slot: the day itself, or the 7th day of a weekly slot. */
export function slotEndKey(slot: Slot, weekly: boolean): string {
  if (!weekly) return slot.key
  return dateKey(addDays(slot.date, 6))
}

/** The slot holding `today`, for a day or a week. */
export function currentSlot(slots: Slot[], today: string, weekly: boolean): Slot | undefined {
  return slots.find(s => s.key <= today && today <= slotEndKey(s, weekly))
}

/** Monday–Sunday of the calendar week containing `now`, as dates. */
export function currentWeekDays(now = new Date()): Date[] {
  const monday = addDays(now, -((now.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/**
 * The deposits that count for the day they're stamped with. A Bulk Savings deposit is stamped when it's
 * paid but counts for the days its coverage rows name, so paying for tomorrow doesn't make today look paid.
 */
export function dayDeposits<T extends { ref?: string }>(deposits: T[], coveredRefs: string[] = []): T[] {
  const covering = new Set(coveredRefs)
  return deposits.filter(d => !d.ref || !covering.has(d.ref))
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
