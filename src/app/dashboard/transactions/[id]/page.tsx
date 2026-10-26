'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface Txn {
  id: string; ref: string; type: string; amount: number
  method: string | null; status: string; note: string | null; createdAt: string
  agent: { name: string; agentId: string }
  customer: { name: string; customerId: string; phone: string } | null
  plan: { goal: string; durationDays: number } | null
}

const TYPE_LABEL: Record<string, string> = {
  saving: 'Savings Credit', redemption: 'Redemption Payout', repayment: 'Loan Repayment',
  disbursement: 'Loan Disbursement', enrolment: 'Customer Enrolment', loan: 'Loan Application',
  wallet_funding: 'Wallet Top-up',
}
const TYPE_ICON: Record<string, string> = {
  saving: '💰', redemption: '🎯', repayment: '🔄', disbursement: '💸',
  enrolment: '📋', loan: '🏦', wallet_funding: '💼',
}

export default function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [txn, setTxn] = useState<Txn | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [canPrint, setCanPrint] = useState(false)

  useEffect(() => {
    const check = () => setCanPrint(!!(window as any).__vochusCanPrint)
    check()
    window.addEventListener('vochus:flags-ready', check)
    return () => window.removeEventListener('vochus:flags-ready', check)
  }, [])

  function maskPhone(p: string) {
    if (!p || p.length < 7) return p
    return p.slice(0, 4) + '****' + p.slice(-3)
  }

  function printReceipt() {
    if (!txn) return
    const w = window as any
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
      method: txn.method ?? '',
      agent: txn.agent.name,
      goal: txn.plan?.goal ?? '',
      inviteUrl,
    }))
  }

  useEffect(() => {
    fetch(`/api/transactions/${id}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setTxn(d); setLoading(false) })
      .catch(() => { setError('Failed to load'); setLoading(false) })
  }, [id])

  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: 'var(--mu)' }}>Loading…</div>
  if (error || !txn) return <div style={{ textAlign: 'center', padding: 48, color: 'var(--rd)' }}>{error || 'Not found'}</div>

  const date = new Date(txn.createdAt)
  const amtColor = txn.type === 'saving' ? 'var(--g)' : txn.type === 'redemption' ? 'var(--rd)' : 'var(--b)'
  const amtPrefix = txn.type === 'saving' ? '+' : txn.type === 'redemption' ? '−' : ''
  const showAmt = txn.type !== 'enrolment'

  return (
    <>
      <div className="page-header no-print">
        <h2>Transaction Detail</h2>
        <p>Receipt for {txn.ref}</p>
      </div>

      <div className="no-print" style={{ marginBottom: 16, display: 'flex', gap: 10 }}>
        <button className="btn btn-out btn-sm" onClick={() => router.back()}>← Back</button>
        <button className="btn btn-g btn-sm" onClick={() => window.print()}>⬇ Download Receipt</button>
        {canPrint && (
          <button className="btn btn-g btn-sm" onClick={printReceipt}>🖨 Print Receipt</button>
        )}
      </div>

      <div className="receipt-wrap">
        <div className="receipt">
          <div className="receipt-header">
            <div className="receipt-logo">VES</div>
            <div>
              <div className="receipt-company">Vochus Easy Save</div>
              <div className="receipt-tagline">Official Transaction Receipt</div>
            </div>
          </div>

          <div className="receipt-ref">
            <span className="receipt-ref-label">Transaction Ref</span>
            <span className="receipt-ref-val">{txn.ref}</span>
          </div>

          <div className="receipt-amount-row">
            <span style={{ fontSize: 13, color: '#666' }}>{TYPE_ICON[txn.type]} {TYPE_LABEL[txn.type] ?? txn.type}</span>
            {showAmt && (
              <span className="receipt-amount" style={{ color: amtColor }}>
                {amtPrefix}₦{txn.amount.toLocaleString()}
              </span>
            )}
          </div>

          <div className="receipt-divider" />

          <div className="receipt-rows">
            <div className="receipt-row"><span>Date</span><strong>{date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></div>
            <div className="receipt-row"><span>Time</span><strong>{date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong></div>
            <div className="receipt-row"><span>Status</span><strong style={{ color: txn.status === 'Done' ? '#1a5c35' : '#b45309' }}>{txn.status}</strong></div>
            {txn.method && <div className="receipt-row"><span>Method</span><strong>{txn.method}</strong></div>}
            {txn.customer && (
              <>
                <div className="receipt-row"><span>Customer</span><strong>{txn.customer.name}</strong></div>
                <div className="receipt-row"><span>Customer ID</span><strong>{txn.customer.customerId}</strong></div>
                <div className="receipt-row"><span>Phone</span><strong>{txn.customer.phone}</strong></div>
              </>
            )}
            {txn.plan && (
              <>
                <div className="receipt-row"><span>Plan Goal</span><strong>{txn.plan.goal}</strong></div>
                <div className="receipt-row"><span>Plan Duration</span><strong>{txn.plan.durationDays} Days</strong></div>
              </>
            )}
            <div className="receipt-row"><span>Agent</span><strong>{txn.agent.name}</strong></div>
            <div className="receipt-row"><span>Agent ID</span><strong>{txn.agent.agentId}</strong></div>
            {txn.note && <div className="receipt-row"><span>Note</span><strong>{txn.note}</strong></div>}
          </div>

          <div className="receipt-divider" />
          <div className="receipt-footer">
            This is an official receipt from Vochus Easy Save.<br />
            Keep this for your records. — vochusglobalservices.co.uk
          </div>
        </div>
      </div>
    </>
  )
}
