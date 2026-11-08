// Ajo (rotating group savings): the pure rules. No Prisma, no Node built-ins, so screens and routes share them.
// Server-only pieces (join codes, database work) live in ajo-server.ts.
//
// A group has `size` members and `size` rounds. Every member pays `contribution` each round; when every member has
// paid a round, the member holding that round's slot gets the pot (contribution × size). Round 1 is due on the start
// date (a Lagos day), round N one day / week / calendar month after round N-1. One round at a time: a member can pay
// only the round currently open (owner's decision, Nov 2026).

export const AJO_CADENCES = ['daily', 'weekly', 'monthly'] as const
export type AjoCadence = (typeof AJO_CADENCES)[number]

/** The SavingsPlan cadence that marks an Ajo payout plan (an ended plan holding one round's pot). */
export const AJO_PLAN_CADENCE = 'ajo'
export const isAjoPlan = (p: { cadence?: string | null }) => p.cadence === AJO_PLAN_CADENCE

export const MIN_SIZE = 2
export const MAX_SIZE = 50
export const MIN_CONTRIBUTION = 100
export const MAX_CONTRIBUTION = 5_000_000
export const NAME_MAX = 60

export const isJoinCode = (s: unknown): s is string => typeof s === 'string' && /^\d{6}$/.test(s)

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
/** Lagos is UTC+1 all year. */
export const lagosMidnight = (day: string) => new Date(`${day}T00:00:00+01:00`)
/** The Lagos calendar day (YYYY-MM-DD) of an instant. */
export const lagosDay = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10)

/** The Lagos day round `round` (1-based) is due. Monthly rounds keep the start's day of month, clamped to month end. */
export function roundDueDay(startDate: Date, cadence: AjoCadence, round: number): string {
  const [y, m, d] = lagosDay(startDate).split('-').map(Number)
  const n = round - 1
  let due: Date
  if (cadence === 'monthly') {
    const lastDay = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate()
    due = new Date(Date.UTC(y, m - 1 + n, Math.min(d, lastDay)))
  } else {
    due = new Date(Date.UTC(y, m - 1, d + n * (cadence === 'weekly' ? 7 : 1)))
  }
  return due.toISOString().slice(0, 10)
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = (day: string) => {
  const [, m, d] = day.split('-').map(Number)
  return `${d} ${MONTHS[m - 1].slice(0, 3)}`
}

/** "Day 3 · 12 Nov", "Week 2 · 17 Nov", "December 2026" — how a round (and so a slot) is named on screen. */
export function roundLabel(startDate: Date, cadence: AjoCadence, round: number): string {
  const day = roundDueDay(startDate, cadence, round)
  if (cadence === 'monthly') {
    const [y, m] = day.split('-').map(Number)
    return `${MONTHS[m - 1]} ${y}`
  }
  return `${cadence === 'weekly' ? 'Week' : 'Day'} ${round} · ${SHORT(day)}`
}

export const potOf = (g: { contribution: number; size: number }) => Math.round(g.contribution * g.size * 100) / 100

/** The round open for payment: the lowest round not yet paid out. Null when every round has paid out. */
export function openRound(size: number, paidOutRounds: number[]): number | null {
  const done = new Set(paidOutRounds)
  for (let r = 1; r <= size; r++) if (!done.has(r)) return r
  return null
}

/** Every member has paid this round. */
export function isRoundFunded(memberIds: string[], paidMemberIds: string[]): boolean {
  if (memberIds.length === 0) return false
  const paid = new Set(paidMemberIds)
  return memberIds.every(id => paid.has(id))
}

export type NewGroup = { name: string; cadence: AjoCadence; size: number; contribution: number; startDate: Date }

/** Narrow an untrusted create-group body; errors are per field. The start can't be before today (Lagos). */
export function parseNewGroup(raw: unknown, now: Date = new Date()): { ok: true; value: NewGroup } | { ok: false; errors: Record<string, string> } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const errors: Record<string, string> = {}
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : ''
  const cadence = b.cadence
  const size = Number(b.size)
  const contribution = Number(b.contribution)
  const start = typeof b.startDate === 'string' ? b.startDate : ''

  if (name.length < 2) errors.name = 'Enter a group name.'
  else if (name.length > NAME_MAX) errors.name = `Keep the name to ${NAME_MAX} characters.`
  if (!AJO_CADENCES.includes(cadence as AjoCadence)) errors.cadence = 'Choose daily, weekly or monthly.'
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) errors.size = `A group has ${MIN_SIZE} to ${MAX_SIZE} members.`
  if (!Number.isInteger(contribution) || contribution < MIN_CONTRIBUTION) errors.contribution = `Enter a whole amount of ₦${MIN_CONTRIBUTION} or more.`
  else if (contribution > MAX_CONTRIBUTION) errors.contribution = `The most each member can pay a round is ₦${MAX_CONTRIBUTION.toLocaleString('en-NG')}.`
  if (!DAY_RE.test(start) || Number.isNaN(lagosMidnight(start).getTime())) errors.startDate = 'Choose a start date.'
  else if (start < lagosDay(now)) errors.startDate = 'The start date can’t be in the past.'

  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { name, cadence: cadence as AjoCadence, size, contribution, startDate: lagosMidnight(start) } }
}

/**
 * Check a full slot assignment: every member gets exactly one slot, and slots 1..size are each used once.
 * `assignments` maps memberId → slot.
 */
export function checkSlots(memberIds: string[], size: number, assignments: Record<string, unknown>): { ok: true; slots: Map<string, number> } | { ok: false; error: string } {
  if (memberIds.length !== size) return { ok: false, error: `The group needs all ${size} members before slots can be set.` }
  const slots = new Map<string, number>()
  const used = new Set<number>()
  for (const id of memberIds) {
    const s = Number(assignments[id])
    if (!Number.isInteger(s) || s < 1 || s > size) return { ok: false, error: 'Give every member a slot.' }
    if (used.has(s)) return { ok: false, error: 'Two members have the same slot.' }
    used.add(s)
    slots.set(id, s)
  }
  if (Object.keys(assignments).some(id => !memberIds.includes(id))) return { ok: false, error: 'That person isn’t in this group.' }
  return { ok: true, slots }
}
