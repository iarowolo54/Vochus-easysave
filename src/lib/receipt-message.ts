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
