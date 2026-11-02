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
import { money } from '@/lib/wallet-guard'
import { LOAN_AGENT_COMMISSION, LOAN_REPAY_AGENT_COMMISSION } from '@/lib/wallet-rates'

export type CommissionSource = 'loan' | 'repayment' | 'redemption' | 'reward'
export const COMMISSION_SOURCES: readonly CommissionSource[] = ['loan', 'repayment', 'redemption', 'reward']

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
  return money(principal * LOAN_AGENT_COMMISSION)
}
export function repaymentCommission(amount: number): number {
  return money(amount * LOAN_REPAY_AGENT_COMMISSION)
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
