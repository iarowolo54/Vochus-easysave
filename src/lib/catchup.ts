// Pure math for Bulk Savings ("online catch-up" plus pay-ahead).
//
// A customer on a self-service daily/weekly plan can pay for any day not yet saved:
// missed, today or upcoming. The money is credited now (never backdated) and earns
// from today; the chosen day-keys are recorded as coverage, which interest never reads
// and auto-debit uses to skip days already paid. All amounts are computed server-side
// from the plan rate — never trusted from the client.
import { keyPlusDays, perSlotAmount, type Slot } from './savings-card'

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

export { perSlotAmount }

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
  if (!Array.isArray(keys) || keys.length === 0) return { ok: false, error: 'Pick at least one day' }
  if (keys.length > MAX_KEYS) return { ok: false, error: `You can pay for up to ${MAX_KEYS} at a time` }
  if (new Set(keys).size !== keys.length) return { ok: false, error: 'The same day was picked twice' }

  const open = new Set(selectableKeys(slots))
  for (const key of keys) {
    if (!open.has(key)) return { ok: false, error: `${readableKey(key)} can’t be paid for: it’s already paid or isn’t part of this plan` }
  }

  return { ok: true, total: money(perSlotAmount(plan) * keys.length) }
}

/** A slot key as a date a customer can read: "3 Nov". */
export function readableKey(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return 'That day'
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** Keys of the slots a customer may pick: anything not yet saved or covered. */
export function selectableKeys(slots: Slot[]): string[] {
  return slots.filter(s => s.state !== 'saved').map(s => s.key)
}

export function missedKeys(slots: Slot[]): string[] {
  return slots.filter(s => s.state === 'missed').map(s => s.key)
}

/** True once "select all missed" has nothing left to add: all are picked, or the cap stopped it partway. */
export function allMissedChosen(selected: Set<string>, missed: string[], max: number): boolean {
  if (missed.length === 0) return false
  if (missed.every(k => selected.has(k))) return true
  return selected.size >= max && missed.some(k => selected.has(k))
}

/** "Select all missed": adds missed slots to the picks, or takes them back out. Future picks are never touched. */
export function toggleAllMissed(selected: Set<string>, missed: string[], max: number): Set<string> {
  const next = new Set(selected)
  if (allMissedChosen(selected, missed, max)) {
    for (const key of missed) next.delete(key)
    return next
  }
  for (const key of missed) {
    if (next.size >= max) break
    next.add(key)
  }
  return next
}

/** What a weekly selection actually buys, above the pay button: "Weeks 2–4 · 9 Nov – 29 Nov". Empty for daily plans. */
export function slotSummary(slots: Slot[], selected: Set<string>, weekly: boolean): string {
  if (!weekly) return ''
  const picked = slots.filter(s => selected.has(s.key))
  if (picked.length === 0) return ''
  const runs: Slot[][] = []
  for (const slot of picked) {
    const run = runs[runs.length - 1]
    if (run && run[run.length - 1].index === slot.index - 1) run.push(slot)
    else runs.push([slot])
  }
  const numbers = runs.map(r => (r.length === 1 ? `${r[0].index}` : `${r[0].index}–${r[r.length - 1].index}`)).join(', ')
  const dates = runs.map(r => `${readableKey(r[0].key)} – ${readableKey(keyPlusDays(r[r.length - 1].key, 6))}`).join(', ')
  return `${picked.length === 1 ? 'Week' : 'Weeks'} ${numbers} · ${dates}`
}

/** Total for `count` chosen slots, using the same rate the server charges. */
export function selectionTotal(plan: RatePlan, count: number): number {
  return money(perSlotAmount(plan) * Math.max(0, count))
}
