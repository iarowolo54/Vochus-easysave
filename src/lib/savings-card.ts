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

type PlanLike = { startDate: string; maturityDate: string; periodDays: number; cadence?: string; source?: string; dailyAmount?: number }

/** A deposit for the calendar. A bare date counts as a full payment, for callers with no amounts (offline plans). */
export type SlotDeposit = string | { createdAt: string; amount: number }

/** Amount that covering one slot costs: a day for daily plans, a full week for weekly. */
export function perSlotAmount(plan: { cadence?: string; dailyAmount: number }): number {
  return (plan.cadence ?? 'daily') === 'weekly' ? plan.dailyAmount * 7 : plan.dailyAmount
}

/**
 * The one definition of a funded slot on an online plan, for the calendar, Bulk Savings and auto-debit: deposits in it have
 * reached the full plan amount. Rounded because these are floats: 0.1 + 0.2 must reach 0.3.
 */
export function reachesSlotAmount(plan: { cadence?: string; dailyAmount: number }, paid: number): boolean {
  return Math.round(paid * 100) >= Math.round(perSlotAmount(plan) * 100)
}

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
  plan: PlanLike, deposits: SlotDeposit[], coveredKeys: string[], now: Date,
  keyOf: (d: Date) => string, dateOf: (key: string) => Date,
): Slot[] {
  const dated = deposits.map(d => (typeof d === 'string'
    ? { key: keyOf(new Date(d)), amount: Infinity }
    : { key: keyOf(new Date(d.createdAt)), amount: d.amount }))
  // Online plans count a slot only at the full amount. Offline: any deposit counts, as it always has.
  const dailyAmount = plan.source === 'self' ? plan.dailyAmount : undefined
  const funded = (first: string, last: string) => {
    const inSlot = dated.filter(d => d.key >= first && d.key <= last)
    if (dailyAmount === undefined) return inSlot.length > 0
    return inSlot.length > 0 && reachesSlotAmount({ cadence: plan.cadence, dailyAmount }, inSlot.reduce((sum, d) => sum + d.amount, 0))
  }
  const covered = new Set(coveredKeys)
  const today = keyOf(now)
  const startKey = keyOf(new Date(plan.startDate))

  if (!isWeekly(plan)) {
    return Array.from({ length: plan.periodDays }, (_, i) => {
      const key = keyPlusDays(startKey, i)
      const isPaid = funded(key, key)
      const isCovered = covered.has(key)
      const state: SlotState = isPaid || isCovered ? 'saved' : key < today ? 'missed' : key === today ? 'today' : 'upcoming'
      return { key, date: dateOf(key), index: i + 1, state, coveredOnly: !isPaid && isCovered }
    })
  }

  const weeks = Math.ceil(plan.periodDays / 7)
  return Array.from({ length: weeks }, (_, w) => {
    const first = keyPlusDays(startKey, w * 7)
    const last = keyPlusDays(startKey, w * 7 + 6)
    const hasDeposit = funded(first, last)
    const hasCover = [...covered].some(k => k >= first && k <= last)
    const saved = hasDeposit || hasCover
    const state: SlotState = saved ? 'saved' : last < today ? 'missed' : first <= today ? 'today' : 'upcoming'
    return { key: first, date: dateOf(first), index: w + 1, state, coveredOnly: !hasDeposit && hasCover }
  })
}

export function buildSlots(plan: PlanLike, deposits: SlotDeposit[], coveredKeys: string[] = [], now = new Date()): Slot[] {
  return slotsFor(plan, deposits, coveredKeys, now, dateKey, localMidnight)
}

/** buildSlots for the server: PM2 sets no TZ, so slot days must be pinned to WAT, where customers' phones are. */
export function buildSlotsWat(plan: PlanLike, deposits: SlotDeposit[], coveredKeys: string[] = [], now = new Date()): Slot[] {
  return slotsFor(plan, deposits, coveredKeys, now, watKey, watMidnight)
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

/** The slot key for a date on a calendar: the day itself, or the first day of the week holding it. Null if outside the plan. */
export function slotKeyForDate(slots: Pick<Slot, 'key'>[], date: string, weekly: boolean): string | null {
  const slot = slots.find(s => s.key <= date && date <= (weekly ? keyPlusDays(s.key, 6) : s.key))
  return slot?.key ?? null
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
