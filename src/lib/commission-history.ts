// Reconstructs an agent's earned-commission history from the sources that actually
// credit commissionBalance today: loan disbursements, repayments, early redemptions,
// and reward fees. Savings/enrolments earn nothing in the current model, so they are
// deliberately excluded (showing them at ₦0 would mislead).
//
// Accuracy: loans (principal × 1%), repayments (amount × 0.5%) and rewards (stored
// amount) are EXACT. Redemption commission is reconstructed from the admin
// EarlyRedemption flow as penalty × 3/5 — exact for redemptions completed via
// redemptionCompletionOps, but the OTP-finalised and agent-initiated redemption paths
// credit a differently-computed amount that isn't stored per event, so those are
// approximate or not yet surfaced. Exact per-event figures need the forthcoming
// commission-entry ledger (the separate "make commission fully functional" work).
// Treat the total as EARNED (not the current balance — payouts reduce the balance).
import { money } from '@/lib/money'

// What loans and repayments paid before the rates page drove them. Used only to reconstruct events that have no
// ledger row, so a later rate change never rewrites old history.
const LEGACY_LOAN_RATE = 0.01
const LEGACY_REPAY_RATE = 0.005

export type CommissionSource = 'loan' | 'repayment' | 'redemption' | 'reward' | 'savings'
export const COMMISSION_SOURCES: readonly CommissionSource[] = ['loan', 'repayment', 'redemption', 'reward', 'savings']

/** The agent's share of a redemption penalty (3/5), matching redemption-complete.ts. */
export const REDEMPTION_AGENT_FRACTION = 3 / 5

export interface CommissionEntry {
  id: string
  date: string          // ISO
  source: CommissionSource
  commission: number    // naira the agent earned
  baseAmount: number    // what it was computed from (principal / repayment / penalty / reward amount)
  customerId: string | null
  customerName: string | null
  planGoal: string | null
  ref: string | null
  status: string | null
}

export function loanCommission(principal: number): number {
  return money(principal * LEGACY_LOAN_RATE)
}
export function repaymentCommission(amount: number): number {
  return money(amount * LEGACY_REPAY_RATE)
}
export function redemptionCommission(penalty: number): number {
  return money(penalty * REDEMPTION_AGENT_FRACTION)
}

export interface CommissionFilter {
  from?: string            // inclusive ISO date (start of day)
  to?: string              // inclusive ISO date (end of day)
  sources?: CommissionSource[]
  q?: string               // customer name / id search
  status?: string
}

/** Parse a YYYY-MM-DD day boundary in local time; null for missing/malformed/invalid. */
export function parseDayBoundary(s: string | undefined | null, end: boolean): number | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const t = new Date(`${s}T${end ? '23:59:59.999' : '00:00:00.000'}`).getTime()
  return Number.isNaN(t) ? null : t
}

export function filterEntries(entries: CommissionEntry[], f: CommissionFilter): CommissionEntry[] {
  const fromMs = parseDayBoundary(f.from, false)
  const toMs = parseDayBoundary(f.to, true)
  const sources = f.sources && f.sources.length ? new Set(f.sources) : null
  const q = f.q?.trim().toLowerCase() || null
  const status = f.status?.trim() || null

  return entries.filter((e) => {
    if (fromMs !== null || toMs !== null) {
      const t = new Date(e.date).getTime()
      if (fromMs !== null && t < fromMs) return false
      if (toMs !== null && t > toMs) return false
    }
    if (sources && !sources.has(e.source)) return false
    if (q) {
      const hay = `${e.customerName ?? ''} ${e.customerId ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (status && e.status !== status) return false
    return true
  })
}

export function sumCommission(entries: CommissionEntry[]): number {
  return money(entries.reduce((s, e) => s + e.commission, 0))
}

export interface LedgerRow {
  id: string
  source: string
  sourceRef: string
  base: number
  amount: number
  createdAt: Date
  customerId: string | null   // internal id
}

const LEDGER_SOURCE: Record<string, CommissionSource> = {
  daily_first: 'savings', periodic_fee: 'savings', settle_up: 'redemption', loan: 'loan', repayment: 'repayment', redemption_fee: 'redemption',
}

/** Agent ledger rows as drawer entries. `customers` maps internal customer id to its display name and id. */
export function entriesFromLedger(rows: LedgerRow[], customers: Map<string, { name: string; customerId: string }>): CommissionEntry[] {
  return rows.map((r): CommissionEntry => {
    const c = r.customerId ? customers.get(r.customerId) : undefined
    return {
      id: r.id, date: r.createdAt.toISOString(), source: LEDGER_SOURCE[r.source] ?? 'savings',
      commission: r.amount, baseAmount: r.base,
      customerId: c?.customerId ?? null, customerName: c?.name ?? null, planGoal: null, ref: r.sourceRef, status: 'Done',
    }
  })
}

/** Ledger entries are exact, so a reconstructed entry for the same event (same source and ref) is dropped. */
export function mergeHistory(ledger: CommissionEntry[], reconstructed: CommissionEntry[]): CommissionEntry[] {
  const have = new Set(ledger.map(e => `${e.source}:${e.ref}`))
  return [...ledger, ...reconstructed.filter(e => !have.has(`${e.source}:${e.ref}`))]
}
