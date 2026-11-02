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
}

// Goal and names are free text. Without this, a line break in one could fake a receipt line.
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 60)

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
 * Why a payout's receipt can't be sent yet, or null if it can. Payout rows are written as Done once
 * Paystack accepts the transfer and aren't updated if it later fails, so the row's status can't be
 * trusted. An interest row's method is always Cash, so only the redemption record says how it was paid.
 */
export function payoutBlock(
  t: { type: string; method: string | null },
  record: { payoutMethod: string | null; bankTransferStatus: string | null } | null,
): string | null {
  const notConfirmed = 'This bank payout isn’t confirmed yet, so the receipt can’t be sent.'
  // No redemption record: an agent's direct payout, which only cash can vouch for.
  if (!record) return t.type === 'redemption' && t.method?.toLowerCase() === 'cash' ? null : notConfirmed
  // Same test as the admin approve route: anything else never goes through Paystack.
  if (record.payoutMethod !== 'Bank Transfer' && record.payoutMethod !== 'BankTransfer') return null
  const status = record.bankTransferStatus
  if (status === 'success' || status === 'manual') return null
  return status === 'failed' || status === 'reversed'
    ? `This bank payout ${status === 'failed' ? 'failed' : 'was reversed'}, so the receipt can’t be sent.`
    : notConfirmed
}

/** One transaction gives a normal receipt; several (a Bulk Savings payment) give one combined receipt. */
export function buildReceiptMessage(txns: ReceiptTxn[], who: { customerName: string; agentName: string }): string {
  const [first] = txns
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
    `Status: ${statusLabel(first.status)}`,
    `Customer: ${displayName(oneLine(who.customerName))}`,
    goal ? `Plan: ${goal}` : '',
    bulk ? `Paid for: ${paidFor(txns)}` : `Date: ${lagosDate(first.createdAt)}, ${lagosTime(first.createdAt)}`,
    selfPaid ? '' : `Recorded by: ${oneLine(who.agentName)}`,
    `Reference: ${first.ref}${bulk ? ` +${txns.length - 1} more` : ''}`,
  ].filter(Boolean).join('\n')
}
