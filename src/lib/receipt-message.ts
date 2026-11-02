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
}

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

function dateRange(txns: ReceiptTxn[]): string {
  const times = txns.map(t => t.createdAt.getTime())
  const first = lagosDate(new Date(Math.min(...times)))
  const last = lagosDate(new Date(Math.max(...times)))
  return first === last ? first : `${first} to ${last}`
}

/** One transaction gives a normal receipt; several (a Bulk Savings payment) give one combined receipt. */
export function buildReceiptMessage(txns: ReceiptTxn[], who: { customerName: string; agentName: string }): string {
  const [first] = txns
  const bulk = txns.length > 1
  const details = bulk
    ? [
        'Vochus Easy Save — Bulk Savings receipt',
        `Total: ${formatNaira(money(txns.reduce((sum, t) => sum + t.amount, 0)))}`,
        `Days: ${txns.length}`,
      ]
    : [
        `Vochus Easy Save — ${label(first.type).toLowerCase()} receipt`,
        first.type === 'enrolment' ? '' : `Amount: ${formatNaira(first.amount)}`,
      ]

  return [
    ...details,
    `Status: ${statusLabel(first.status)}`,
    `Customer: ${displayName(who.customerName)}`,
    first.planGoal ? `Plan: ${first.planGoal}` : '',
    bulk ? `Dates: ${dateRange(txns)}` : `Date: ${lagosDate(first.createdAt)}, ${lagosTime(first.createdAt)}`,
    `Recorded by: ${who.agentName}`,
    `Reference: ${first.ref}${bulk ? ` +${txns.length - 1} more` : ''}`,
  ].filter(Boolean).join('\n')
}
