'use client'
import { useState } from 'react'
import { Icons, type IconName } from '@/components/ui/icons'
import { formatDate, formatNaira, formatTime } from '@/lib/format'
import { methodText } from '@/lib/hand-receipt'

export type ReceiptTx = {
  id: string; amount: number; ref: string; createdAt: string; method: string | null
  /** Agent name; only known for some transactions. */
  recordedBy?: string
  /** Set when an agent paid this into an online plan; the receipt says so. */
  paidByAgent?: string | null
  /** Transaction type from the API; defaults to a savings deposit. */
  type?: string
  /** Raw status from the API ("Done", "Pending", …). Defaults to Done. */
  status?: string
  /** Platform fee taken out of this deposit, if any. */
  feeTaken?: number
  /** A bank transfer staff checked and credited by hand. */
  confirmedByStaff?: boolean
}

type Direction = 'in' | 'out' | 'none'

/** Plain names and money direction for each transaction type, from the customer's side. */
export function txMeta(type = 'saving'): { label: string; direction: Direction; planLabel: string } {
  switch (type) {
    case 'saving':       return { label: 'Savings deposit', direction: 'in',   planLabel: 'Paid into' }
    case 'redemption':   return { label: 'Redemption',      direction: 'out',  planLabel: 'Paid from' }
    case 'disbursement': return { label: 'Loan received',   direction: 'in',   planLabel: 'Plan' }
    case 'repayment':    return { label: 'Loan repayment',  direction: 'out',  planLabel: 'Plan' }
    case 'enrolment':    return { label: 'Enrolment',       direction: 'none', planLabel: 'Plan' }
    case 'registration': return { label: 'Registration',    direction: 'none', planLabel: 'Plan' }
    case 'fee_refund':   return { label: 'Fee refund',      direction: 'in',   planLabel: 'Paid into' }
    default:             return { label: type.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()), direction: 'none', planLabel: 'Plan' }
  }
}

/** Completed / Pending / Failed, from the raw API status. */
export function txStatus(raw = 'Done'): { label: string; tone: 'success' | 'warn' | 'danger'; icon: IconName } {
  const s = raw.toLowerCase()
  if (s === 'done' || s === 'completed' || s === 'success') return { label: 'Completed', tone: 'success', icon: 'check' }
  if (s === 'pending' || s === 'processing') return { label: 'Pending', tone: 'warn', icon: 'pending' }
  return { label: raw === 'Failed' || s === 'failed' ? 'Failed' : raw, tone: 'danger', icon: 'error' }
}

/** Icon that says how the money moved (information, not decoration). */
export function depositIcon(tx: Pick<ReceiptTx, 'method' | 'type'>): IconName {
  const t = tx.type ?? 'saving'
  if (t !== 'saving') return txMeta(t).direction === 'out' ? 'withdraw' : 'deposit'
  const m = (tx.method ?? 'Cash').toLowerCase()
  return m === 'paystack' ? 'card' : m === 'cash' ? 'cash' : 'deposit'
}

/** How the money moved, said plainly. Cash names the agent; a bank transfer says whether staff confirmed it. */
export function depositMethod(tx: Pick<ReceiptTx, 'method' | 'recordedBy' | 'confirmedByStaff' | 'paidByAgent'>): string {
  return methodText(tx)
}

/** One or two words for list rows; the receipt carries the full wording (who collected it). */
export function methodShort(method: string | null, paidByAgent?: string | null): string {
  if (paidByAgent) return 'Paid by agent'
  const m = (method ?? 'Cash').toLowerCase()
  return m === 'paystack' ? 'Card' : m === 'cash' ? 'Cash' : (method ?? 'Cash')
}

export function signedAmount(tx: Pick<ReceiptTx, 'amount' | 'type'>): string {
  const d = txMeta(tx.type).direction
  return `${d === 'in' ? '+' : d === 'out' ? '−' : ''}${formatNaira(tx.amount)}`
}

type Props = {
  tx: ReceiptTx
  planName?: string | null
  hideAmounts: boolean
  onHelp: () => void
  /** Saves the receipt as an image (History provides this). */
  onDownload?: () => void
  /** Shares the receipt as an image; resolves false when the device can't, and the text is shared instead. */
  onShare?: () => Promise<boolean>
}

/** Receipt for any transaction. Same layout everywhere so customers learn to read it once. */
export default function DepositReceipt({ tx, planName, hideAmounts, onHelp, onDownload, onShare }: Props) {
  const [copied, setCopied] = useState(false)
  const meta = txMeta(tx.type)
  const status = txStatus(tx.status)
  const StatusIcon = Icons[status.icon]
  const when = `${formatDate(tx.createdAt)}, ${formatTime(tx.createdAt)}`
  const text = [
    `Vochus Easy Save — ${meta.label.toLowerCase()} receipt`,
    `Amount: ${signedAmount(tx)}`,
    `Status: ${status.label}`,
    `Date: ${when}`,
    ...(planName ? [`${meta.planLabel}: ${planName}`] : []),
    `Method: ${depositMethod(tx)}`,
    `Reference: ${tx.ref}`,
  ].join('\n')

  async function copyRef() {
    try {
      await navigator.clipboard.writeText(tx.ref)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* some WebViews block the clipboard; the reference stays visible to read out */ }
  }

  async function share() {
    try {
      if (onShare && await onShare()) return
      if (navigator.share) { await navigator.share({ title: `${meta.label} receipt`, text }); return }
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* cancelled or blocked */ }
  }

  return (
    <div className="ui-receipt">
      <div className="ui-receipt-head">
        <span className="ui-row-sub">{meta.label}</span>
        <span className={`ui-amount ui-receipt-amount${meta.direction === 'in' ? '' : ' ui-receipt-amount--plain'}`}>
          {hideAmounts ? '₦ ••••' : tx.amount > 0 ? signedAmount(tx) : '—'}
        </span>
        <span className={`ui-status ui-status--${status.tone}`}><StatusIcon size={14} aria-hidden="true" /> {status.label}</span>
      </div>

      <dl className="ui-receipt-rows">
        <div><dt>Date</dt><dd>{when}</dd></div>
        {planName && <div><dt>{meta.planLabel}</dt><dd>{planName}</dd></div>}
        <div><dt>Method</dt><dd>{depositMethod(tx)}</dd></div>
        {!!tx.feeTaken && tx.feeTaken > 0 && <div><dt>Platform fee</dt><dd>{hideAmounts ? '₦ ••••' : `−${formatNaira(tx.feeTaken)}`}</dd></div>}
        <div>
          <dt>Reference</dt>
          <dd className="ui-receipt-ref">
            <span>{tx.ref}</span>
            <button type="button" className="ui-link" onClick={copyRef} aria-label="Copy reference">
              {copied ? <><Icons.check size={16} aria-hidden="true" /> Copied</> : 'Copy'}
            </button>
          </dd>
        </div>
      </dl>

      <div className="ui-stack">
        {onDownload && (
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={onDownload}>
            <Icons.download size={18} aria-hidden="true" /> Save receipt image
          </button>
        )}
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={share}>
          <Icons.share size={18} aria-hidden="true" /> Share receipt
        </button>
        <button type="button" className="ui-btn ui-btn--plain ui-btn--block" onClick={onHelp}>
          Something wrong? Get help
        </button>
      </div>
    </div>
  )
}
