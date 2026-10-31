// Pure catch-up math for the "online catch-up" feature.
//
// A customer on a self-service daily/weekly plan can top up previously *missed*
// days. The money is credited now (never backdated); the chosen day-keys are
// recorded as display-only coverage. All amounts are computed server-side from
// the plan rate — never trusted from the client.
import type { Slot } from './savings-card'

// Kept local (same maths as `money` in wallet-guard) so this module stays client-safe:
// wallet-guard imports next/server, which must not be pulled into the customer UI bundle.
function money(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

type RatePlan = { cadence?: string; dailyAmount: number }
type EligiblePlan = { status: string; source: string; cadence?: string }

export const MAX_CATCHUP_KEYS = 90
const MAX_KEYS = MAX_CATCHUP_KEYS

/** Amount that covering one slot costs: a day for daily plans, a full week for weekly. */
export function perSlotAmount(plan: RatePlan): number {
  const weekly = (plan.cadence ?? 'daily') === 'weekly'
  return weekly ? plan.dailyAmount * 7 : plan.dailyAmount
}

/** Only Active, self-service, daily/weekly plans can catch up (not monthly/offline/closed). */
export function isEligiblePlan(plan: EligiblePlan): boolean {
  const cadence = plan.cadence ?? 'daily'
  return plan.status === 'Active' && plan.source === 'self' && (cadence === 'daily' || cadence === 'weekly')
}

export type SelectionResult = { ok: true; total: number } | { ok: false; error: string }

/**
 * Validate a client's chosen day-keys against the plan's live slots. Every key must be
 * unique and name a slot that is *currently* `missed`; the count must be 1..90. Returns
 * the server-computed total (perSlotAmount * count, rounded) or a reason for rejection.
 */
export function validateSelection(plan: RatePlan, slots: Slot[], keys: string[]): SelectionResult {
  if (!Array.isArray(keys) || keys.length === 0) return { ok: false, error: 'No days selected' }
  if (keys.length > MAX_KEYS) return { ok: false, error: `At most ${MAX_KEYS} days` }
  if (new Set(keys).size !== keys.length) return { ok: false, error: 'Duplicate day selected' }

  const missed = new Set(slots.filter(s => s.state === 'missed').map(s => s.key))
  for (const key of keys) {
    if (!missed.has(key)) return { ok: false, error: `Day ${key} is not a missed day` }
  }

  return { ok: true, total: money(perSlotAmount(plan) * keys.length) }
}

/** Keys of the slots a customer may pick: only `missed` ones (today, upcoming, saved and covered are not). */
export function selectableKeys(slots: Slot[]): string[] {
  return slots.filter(s => s.state === 'missed').map(s => s.key)
}

/** Total for `count` chosen slots, using the same rate the server charges. */
export function selectionTotal(plan: RatePlan, count: number): number {
  return money(perSlotAmount(plan) * Math.max(0, count))
}
