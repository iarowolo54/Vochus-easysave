'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import Logo from '@/components/Logo'
import EmptyState from '@/components/ui/EmptyState'
import { SendReceiptButton, SendReceiptNotices } from '@/components/ui/SendReceipt'
import { Bone } from '@/components/ui/Skeleton'
import { Icons, type IconName } from '@/components/ui/icons'
import { txStatus } from '@/components/customer/DepositReceipt'
import { displayName, formatDate, formatNaira, formatTime } from '@/lib/format'
import { saveReceiptImage } from '@/lib/receipt-image'
import { createReceiptSender, printerMethod, SEND_IDLE } from '@/lib/receipt-send'
import { waLink } from '@/lib/whatsapp'

interface Txn {
  id: string; ref: string; type: string; amount: number
  method: string | null; status: string; receiptStatus: string; canSendReceipt: boolean
  note: string | null; createdAt: string
  agent: { name: string; agentId: string }
  customer: { name: string; customerId: string; phone: string } | null
  plan: { goal: string; durationDays: number } | null
}

const TYPES: Record<string, { label: string; icon: IconName; sign: '+' | '−' | '' }> = {
  saving: { label: 'Savings deposit', icon: 'deposit', sign: '+' },
  redemption: { label: 'Collection payout', icon: 'withdraw', sign: '−' },
  repayment: { label: 'Loan repayment', icon: 'repay', sign: '+' },
  disbursement: { label: 'Loan paid out', icon: 'withdraw', sign: '−' },
  enrolment: { label: 'Customer enrolment', icon: 'enrol', sign: '' },
  registration: { label: 'Registration fee', icon: 'enrol', sign: '' },
  loan: { label: 'Loan application', icon: 'loan', sign: '' },
  wallet_funding: { label: 'Wallet top-up', icon: 'wallet', sign: '+' },
}
const meta = (t: string) => TYPES[t] ?? { label: t.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()), icon: 'history' as IconName, sign: '' as const }

function maskPhone(p: string) {
  if (!p || p.length < 7) return p
  return p.slice(0, 4) + '****' + p.slice(-3)
}

export default function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [txn, setTxn] = useState<Txn | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [canPrint, setCanPrint] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [send, setSend] = useState(SEND_IDLE)
  const [sender] = useState(() => createReceiptSender(setSend))

  useEffect(() => {
    const check = () => setCanPrint(!!(window as unknown as { __vochusCanPrint?: boolean }).__vochusCanPrint)
    check()
    window.addEventListener('vochus:flags-ready', check)
    return () => window.removeEventListener('vochus:flags-ready', check)
  }, [])

  useEffect(() => {
    fetch(`/api/transactions/${id}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setTxn(d); setLoading(false) })
      .catch(() => { setError('We couldn’t load this receipt. Check your connection.'); setLoading(false) })
  }, [id])

  // Payload for the app's receipt printer: keep these fields as they are.
  function printReceipt() {
    if (!txn) return
    const w = window as unknown as { VochusPrinter?: { postMessage: (s: string) => void } }
    if (!w.VochusPrinter) return
    const date = new Date(txn.createdAt)
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const inviteUrl = txn.agent.agentId ? `${origin}/customer/enroll?aid=${txn.agent.agentId}` : ''
    w.VochusPrinter.postMessage(JSON.stringify({
      ref: txn.ref,
      date: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      customer: txn.customer?.name ?? '—',
      customerId: txn.customer?.customerId ?? '',
      phone: maskPhone(txn.customer?.phone ?? ''),
      amount: txn.type === 'enrolment' ? 'N/A' : txn.amount.toLocaleString(),
      method: printerMethod(txn.method, txn.receiptStatus),
      agent: txn.agent.name,
      goal: txn.plan?.goal ?? '',
      inviteUrl,
    }))
  }

  if (loading) {
    return (
      <div className="ag-page">
        <div className="ui-card ag-receipt ui-skeleton" aria-hidden="true">
          <Bone w={48} h={48} round center /><div style={{ height: 16 }} /><Bone w="40%" h={14} center /><div style={{ height: 10 }} />
          <Bone w="60%" h={40} center /><div style={{ height: 24 }} />
          {Array.from({ length: 6 }, (_, i) => <div key={i} style={{ marginBottom: 14 }}><Bone h={18} /></div>)}
        </div>
      </div>
    )
  }

  if (error || !txn) {
    return (
      <div className="ag-page">
        <section className="ui-card ag-receipt">
          <EmptyState icon="error" tone="danger" title="Receipt not found" text={error || 'This transaction doesn’t exist or isn’t yours.'}
            action={<Link href="/dashboard/transactions" className="ui-btn ui-btn--secondary">Back to transactions</Link>} />
        </section>
      </div>
    )
  }

  const m = meta(txn.type)
  // From the server, because a payout row says Done even when the transfer hasn't gone through.
  // txStatus would read Processing as Pending.
  const baseStatus = txStatus(txn.receiptStatus)
  const status = txn.receiptStatus === 'Processing' ? { ...baseStatus, label: 'Processing' } : baseStatus
  const StatusIcon = Icons[status.icon]
  const showAmt = txn.type !== 'enrolment'
  const amount = `${m.sign}${formatNaira(txn.amount)}`
  const when = `${formatDate(txn.createdAt)}, ${formatTime(txn.createdAt)}`
  const customer = txn.customer ? displayName(txn.customer.name) : ''

  const rows: [string, string][] = [
    ['Date', when],
    ...(txn.method ? [['Paid by', txn.method] as [string, string]] : []),
    ...(txn.customer ? [['Customer', `${customer} (${txn.customer.customerId})`] as [string, string]] : []),
    ...(txn.plan ? [['Plan', `${txn.plan.goal} · ${txn.plan.durationDays} days`] as [string, string]] : []),
    ['Agent', `${displayName(txn.agent.name)} (${txn.agent.agentId})`],
    ...(txn.note ? [['Note', txn.note] as [string, string]] : []),
  ]

  const shareText = [
    `Vochus Easy Save — ${m.label.toLowerCase()} receipt`,
    showAmt ? `Amount: ${amount}` : '',
    `Status: ${status.label}`,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    `Reference: ${txn.ref}`,
  ].filter(Boolean).join('\n')

  async function copyRef() {
    try { await navigator.clipboard.writeText(txn!.ref); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* reference stays visible */ }
  }

  async function saveImage() {
    setSaving(true)
    try {
      await saveReceiptImage({ title: m.label, amount: showAmt ? amount : '—', status: status.label, rows, reference: txn!.ref })
    } finally { setSaving(false) }
  }

  return (
    <div className="ag-page">
      <div className="ag-receipt-wrap">
        <div className="ag-receipt-top no-print">
          <Link href="/dashboard/transactions" className="ui-link"><Icons.back size={18} aria-hidden="true" /> All transactions</Link>
        </div>

        <article className="ui-card ag-receipt" aria-label={`${m.label} receipt`}>
          <header className="ag-receipt-brand">
            <Logo size={32} />
            <span>Vochus Easy Save</span>
            <span className="ag-receipt-kind">Receipt</span>
          </header>

          <div className="ui-receipt-head">
            <span className={`ag-receipt-icon ag-tx-icon--${m.sign === '+' ? 'in' : m.sign === '−' ? 'out' : 'neutral'}`} aria-hidden="true">
              {(() => { const I = Icons[m.icon]; return <I size={24} /> })()}
            </span>
            <span className="ui-row-sub">{m.label}</span>
            {showAmt && <span className={`ui-amount ag-receipt-amount${m.sign === '+' ? '' : ' ui-receipt-amount--plain'}`}>{amount}</span>}
            {customer && <span className="ag-receipt-for">{m.sign === '−' ? 'to' : 'from'} <strong>{customer}</strong></span>}
            <span className={`ui-status ui-status--${status.tone}`}><StatusIcon size={14} aria-hidden="true" /> {status.label}</span>
          </div>

          <dl className="ui-receipt-rows">
            {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            {txn.customer?.phone && <div><dt>Customer phone</dt><dd><a className="ui-link" href={`tel:${txn.customer.phone}`}>{txn.customer.phone}</a></dd></div>}
            <div>
              <dt>Reference</dt>
              <dd className="ui-receipt-ref">
                <span>{txn.ref}</span>
                <button type="button" className="ui-link no-print" onClick={copyRef}>{copied ? 'Copied' : 'Copy'}</button>
              </dd>
            </div>
          </dl>

          <p className="ag-receipt-foot">Official receipt from Vochus Easy Save. Keep it for your records.</p>

          <div className="no-print"><SendReceiptNotices send={send} /></div>

          <div className="ag-receipt-actions no-print">
            {txn.customer && txn.canSendReceipt && <SendReceiptButton send={send} onSend={() => sender.send([txn.id])} />}
            {txn.customer?.phone && (
              <a className={`ui-btn ${send.state === 'sent' && !send.canOpenChat ? 'ui-btn--primary' : 'ui-btn--secondary'}`} style={{ gridColumn: '1 / -1' }} href={waLink(txn.customer.phone, shareText)} target="_blank" rel="noopener noreferrer">
                <Icons.share size={18} aria-hidden="true" /> Send on WhatsApp
              </a>
            )}
            <button type="button" className="ui-btn ui-btn--secondary" onClick={saveImage} disabled={saving}>
              {saving ? <span className="ui-spinner ui-spinner--sm ag-spin-dark" aria-hidden="true" /> : <Icons.image size={18} aria-hidden="true" />} Save image
            </button>
            {/* The printed slip can't say a payout failed, so a failed one isn't offered. */}
            {canPrint
              ? txn.canSendReceipt && <button type="button" className="ui-btn ui-btn--secondary" onClick={printReceipt}><Icons.print size={18} aria-hidden="true" /> Print</button>
              : <button type="button" className="ui-btn ui-btn--secondary" onClick={() => window.print()}><Icons.download size={18} aria-hidden="true" /> Print or PDF</button>}
          </div>
        </article>
      </div>
    </div>
  )
}
