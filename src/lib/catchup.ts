// Pure math for Bulk Savings ("online catch-up" plus pay-ahead).
//
// A customer on a self-service daily/weekly plan can pay for any day not yet saved:
// missed, today or upcoming. The money is credited now (never backdated) and earns
// from today; the chosen day-keys are recorded as coverage, which interest never reads
// and auto-debit uses to skip days already paid. All amounts are computed server-side
// from the plan rate — never trusted from the client.
import type { Slot } from './savings-card'

// Kept local (same maths as `money` in wallet-guard) so this module stays client-safe:
// wallet-guard imports next/server, which must not be pulled into the customer UI bundle.
function money(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

type RatePlan = { cadence?: string; dailyAmount: number }
type EligiblePlan = { status: string; source: string; cadence?: string }

export const BULK_SAVINGS_LABEL = 'Bulk Savings'

export const MAX_CATCHUP_KEYS = 90
const MAX_KEYS = MAX_CATCHUP_KEYS

/** Amount that covering one slot costs: a day for daily plans, a full week for weekly. */
export function perSlotAmount(plan: RatePlan): number {
  const weekly = (plan.cadence ?? 'daily') === 'weekly'
  return weekly ? plan.dailyAmount * 7 : plan.dailyAmount
}

/** Only Active, self-service, daily/weekly plans can use Bulk Savings (not monthly/offline/closed). */
export function isEligiblePlan(plan: EligiblePlan): boolean {
  const cadence = plan.cadence ?? 'daily'
  return plan.status === 'Active' && plan.source === 'self' && (cadence === 'daily' || cadence === 'weekly')
}

export type SelectionResult = { ok: true; total: number } | { ok: false; error: string }

/**
 * Validate a client's chosen day-keys against the plan's live slots. Every key must be
 * unique and name a slot that is *currently* unsaved; the count must be 1..90. Returns
 * the server-computed total (perSlotAmount * count, rounded) or a reason for rejection.
 */
export function validateSelection(plan: RatePlan, slots: Slot[], keys: string[]): SelectionResult {
  if (!Array.isArray(keys) || keys.length === 0) return { ok: false, error: 'No days selected' }
  if (keys.length > MAX_KEYS) return { ok: false, error: `At most ${MAX_KEYS} days` }
  if (new Set(keys).size !== keys.length) return { ok: false, error: 'Duplicate day selected' }

  const open = new Set(selectableKeys(slots))
  for (const key of keys) {
    if (!open.has(key)) return { ok: false, error: `Day ${key} can't be paid for: it's already saved or isn't part of this plan` }
  }

  return { ok: true, total: money(perSlotAmount(plan) * keys.length) }
}

/** Keys of the slots a customer may pick: anything not yet saved or covered. */
export function selectableKeys(slots: Slot[]): string[] {
  return slots.filter(s => s.state !== 'saved').map(s => s.key)
}

export function missedKeys(slots: Slot[]): string[] {
  return slots.filter(s => s.state === 'missed').map(s => s.key)
}

/** True once "select all missed" has nothing left to add: all are picked, or the cap is reached. */
export function allMissedChosen(selected: Set<string>, missed: string[], max: number): boolean {
  if (selected.size === 0) return false
  return selected.size >= max || missed.every(k => selected.has(k))
}

/** "Select all missed": adds missed slots to the picks, or clears once they're all in. Never adds a future slot. */
export function toggleAllMissed(selected: Set<string>, missed: string[], max: number): Set<string> {
  if (allMissedChosen(selected, missed, max)) return new Set()
  const next = new Set(selected)
  for (const key of missed) {
    if (next.size >= max) break
    next.add(key)
  }
  return next
}

/** Total for `count` chosen slots, using the same rate the server charges. */
export function selectionTotal(plan: RatePlan, count: number): number {
  return money(perSlotAmount(plan) * Math.max(0, count))
}
