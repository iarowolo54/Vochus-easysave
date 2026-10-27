'use client'
import { useState } from 'react'
import { Icons, type IconName } from '@/components/ui/icons'
import { formatDate, formatNaira, formatTime } from '@/lib/format'

export type ReceiptTx = {
  id: string; amount: number; ref: string; createdAt: string; method: string | null; recordedBy: string
}

/** Icon that says how the money came in (information, not decoration). */
export function depositIcon(tx: Pick<ReceiptTx, 'method'>): IconName {
  const m = (tx.method ?? 'Cash').toLowerCase()
  return m === 'paystack' ? 'card' : m === 'cash' ? 'cash' : 'deposit'
}

/** How the money came in, said plainly. Cash names the agent so customers can spot anything wrong. */
export function depositMethod(tx: Pick<ReceiptTx, 'method' | 'recordedBy'>): string {
  const m = (tx.method ?? 'Cash').toLowerCase()
  if (m === 'paystack') return 'Card or transfer via Paystack'
  if (m === 'cash') return `Cash, collected by ${tx.recordedBy}`
  return `${tx.method}, recorded by ${tx.recordedBy}`
}

type Props = { tx: ReceiptTx; planName: string; hideAmounts: boolean; onHelp: () => void }

/**
 * Receipt for one deposit. Deposits are only recorded once the money is confirmed (agent cash entry,
 * or Paystack after verification), so "Completed" is always true here.
 */
export default function DepositReceipt({ tx, planName, hideAmounts, onHelp }: Props) {
  const [copied, setCopied] = useState(false)
  const when = `${formatDate(tx.createdAt)}, ${formatTime(tx.createdAt)}`
  const text = [
    'Vochus Easy Save — deposit receipt',
    `Amount: ${formatNaira(tx.amount)}`,
    'Status: Completed',
    `Date: ${when}`,
    `Plan: ${planName}`,
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
      if (navigator.share) { await navigator.share({ title: 'Deposit receipt', text }); return }
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* cancelled or blocked */ }
  }

  return (
    <div className="ui-receipt">
      <div className="ui-receipt-head">
        <span className="ui-amount ui-receipt-amount">{hideAmounts ? '₦ ••••' : `+${formatNaira(tx.amount)}`}</span>
        <span className="ui-status ui-status--success"><Icons.check size={14} aria-hidden="true" /> Completed</span>
      </div>

      <dl className="ui-receipt-rows">
        <div><dt>Date</dt><dd>{when}</dd></div>
        <div><dt>Paid into</dt><dd>{planName}</dd></div>
        <div><dt>Method</dt><dd>{depositMethod(tx)}</dd></div>
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
