// The receipt text an agent sends to a customer's in-app chat, built from server records.
// No balance on purpose: an older receipt would show a stale figure.
import { formatNaira, displayName } from '@/lib/format'
import { money } from '@/lib/wallet-guard'

export type ReceiptTxn = {
  ref: string
  type: string
  amount: number
  status: string
  createdAt: Date
  planGoal: string | null
  method: string | null
  /** Set for payout rows; see payoutOutcome. */
  payout?: PayoutOutcome | null
}

export type PayoutOutcome = 'paid' | 'processing' | 'failed' | 'reversed'

// Goal and names are free text. Without this, a line break in one could fake a receipt line.
// Includes invisible and blank-looking characters, which could otherwise pad a value or hide its end.
const oneLine = (s: string) => s.replace(/[\p{C}\p{Z}\u115F\u1160\u3164\uFFA0\u2800]+/gu, ' ').trim().slice(0, 60)

// The customer reads this, so types are named from their side ("Loan received", not "Loan paid out").
const LABELS: Record<string, string> = {
  saving: 'Savings deposit',
  redemption: 'Collection',
  repayment: 'Loan repayment',
  disbursement: 'Loan received',
  enrolment: 'Enrolment',
  registration: 'Registration',
  loan: 'Loan application',
}
const label = (type: string) => LABELS[type] ?? type.replace(/_/g, ' ')

function statusLabel(raw: string): string {
  const s = raw.toLowerCase()
  if (s === 'done' || s === 'completed' || s === 'success') return 'Completed'
  if (s === 'pending' || s === 'processing') return 'Pending'
  return s === 'failed' ? 'Failed' : raw
}

// The server's timezone isn't the customer's, so the app's day (Africa/Lagos) is set explicitly.
const lagosDate = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' })
const lagosTime = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true })

// The days can have gaps, so this doesn't read as a continuous run.
function paidFor(txns: ReceiptTxn[]): string {
  const times = txns.map(t => t.createdAt.getTime())
  const first = lagosDate(new Date(Math.min(...times)))
  const last = lagosDate(new Date(Math.max(...times)))
  return first === last ? `${txns.length} days, recorded ${first}` : `${txns.length} days between ${first} and ${last}`
}

/** The EarlyRedemption ref a row pays out, or null for rows that aren't payouts. Interest rows are written as `<ref>-INT`. */
export function payoutRef(t: { type: string; ref: string }): string | null {
  if (t.type === 'redemption') return t.ref.replace(/-INT$/, '')
  return t.type === 'interest' && t.ref.endsWith('-INT') ? t.ref.slice(0, -4) : null
}

/**
 * What really happened to a payout. Payout rows are written as Done once Paystack accepts the
 * transfer, so the row's status can't be trusted. An interest row's method is always Cash, so only
 * the redemption record says how it was paid. Reads bankTransferStatus as stored, so once transfer
 * webhooks update it, receipts follow without any change here.
 */
export function payoutOutcome(
  t: { type: string; method: string | null },
  record: { payoutMethod: string | null; bankTransferStatus: string | null } | null,
): PayoutOutcome {
  // No redemption record: an agent's direct payout, which only cash can vouch for.
  if (!record) return t.type === 'redemption' && t.method?.toLowerCase() === 'cash' ? 'paid' : 'processing'
  // Same test as the admin approve route: anything else never goes through Paystack.
  if (record.payoutMethod !== 'Bank Transfer' && record.payoutMethod !== 'BankTransfer') return 'paid'
  const status = record.bankTransferStatus
  if (status === 'success' || status === 'manual') return 'paid'
  if (status === 'reversed') return 'reversed'
  // Paystack's docs: abandoned (approval never given), blocked and rejected (our server didn't approve) are final,
  // and the transfer is not processed afterwards. Only pending, otp and received are still on their way.
  if (status === 'failed' || status === 'abandoned' || status === 'blocked' || status === 'rejected') return 'failed'
  return 'processing'
}

/** Same test as customer login: no password, or an account it would refuse, means the chat can't be opened. */
export const customerCanSignIn = (c: { password: string | null; status: string | null }) =>
  !!c.password && (!c.status || c.status.toLowerCase() === 'active')

/** A payout known to have failed or been reversed gets no receipt sent. */
export const canSendReceipt = (payout: PayoutOutcome | null) => payout !== 'failed' && payout !== 'reversed'

/** The status a receipt shows. For a payout, the outcome overrides the row's own Done. */
export function receiptStatus(t: { status: string; payout?: PayoutOutcome | null }): string {
  if (t.payout === 'processing') return 'Processing'
  if (t.payout === 'failed') return 'Failed'
  if (t.payout === 'reversed') return 'Reversed'
  return statusLabel(t.status)
}

/** Earliest date first, then by ref, so a bulk receipt is the same whatever order the days were tapped. */
export function earliestFirst<T extends { createdAt: Date; ref: string }>(txns: T[]): T[] {
  return [...txns].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.ref.localeCompare(b.ref, 'en', { numeric: true }))
}

/** One transaction gives a normal receipt; several (a Bulk Savings payment) give one combined receipt. */
export function buildReceiptMessage(txns: ReceiptTxn[], who: { customerName: string; agentName: string }): string {
  const [first] = earliestFirst(txns)
  const bulk = txns.length > 1
  const goal = oneLine(first.planGoal ?? '')
  // A customer's own Paystack deposit wasn't recorded by the agent.
  const selfPaid = first.type === 'saving' && first.method?.toLowerCase() === 'paystack'
  const details = bulk
    ? [
        'Vochus Easy Save — Bulk Savings receipt',
        `Total: ${formatNaira(money(txns.reduce((sum, t) => sum + t.amount, 0)))}`,
      ]
    : [
        `Vochus Easy Save — ${label(first.type).toLowerCase()} receipt`,
        first.type === 'enrolment' ? '' : `Amount: ${formatNaira(first.amount)}`,
      ]

  return [
    ...details,
    `Status: ${receiptStatus(first)}`,
    `Customer: ${displayName(oneLine(who.customerName))}`,
    goal ? `Plan: ${goal}` : '',
    bulk ? `Paid for: ${paidFor(txns)}` : `Date: ${lagosDate(first.createdAt)}, ${lagosTime(first.createdAt)}`,
    selfPaid ? '' : `Recorded by: ${oneLine(who.agentName)}`,
    `Reference: ${first.ref}${bulk ? ` +${txns.length - 1} more` : ''}`,
  ].filter(Boolean).join('\n')
}
