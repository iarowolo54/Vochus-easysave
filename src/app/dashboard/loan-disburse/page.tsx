'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import BottomSheet from '@/components/ui/BottomSheet'
import EmptyState from '@/components/ui/EmptyState'
import { FormError } from '@/components/ui/FormErrors'
import { ListSkeleton } from '@/components/ui/Skeleton'
import Toast from '@/components/ui/Toast'
import { Icons } from '@/components/ui/icons'
import { avatarTint } from '@/lib/avatar'
import { displayName, formatDate, formatNaira } from '@/lib/format'

interface Loan {
  id: string; ref: string; principal: number; interestRate: number; totalAmount: number
  durationDays: number; dueDate: string; status: string
  customer: { id: string; name: string; customerId: string; phone: string }
}

const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

export default function LoanDisbursePage() {
  const { update } = useSession()
  const [loans, setLoans] = useState<Loan[] | null>(null)
  const [selected, setSelected] = useState<Loan | null>(null)
  const [method] = useState('Cash')
  const [wallet, setWallet] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    fetch('/api/loans?status=Approved')
      .then(r => r.json())
      .then(d => setLoans(d.loans ?? []))
      .catch(() => setLoans(prev => prev ?? []))
    fetch('/api/agent').then(r => r.json()).then(d => { if (typeof d.agent?.walletBalance === 'number') setWallet(d.agent.walletBalance) }).catch(() => {})
  }, [refreshKey])

  async function disburse() {
    if (!selected) { setError('Choose a loan first.'); return }
    setSubmitting(true); setError('')
    try {
      const res = await fetch(`/api/loans/${selected.id}/disburse`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'The payout didn’t go through. Please try again.'); setSubmitting(false); setConfirming(false); return }
      setToast(`${formatNaira(selected.principal, { minor: false })} paid out to ${displayName(selected.customer.name)}`)
      setSelected(null)
      setConfirming(false)
      setRefreshKey(k => k + 1)
      update()
    } catch {
      setError('We lost the connection. Check this list before trying again, so the loan isn’t paid twice.')
      setConfirming(false)
      setRefreshKey(k => k + 1)
    }
    setSubmitting(false)
  }

  const short = selected && wallet !== null && wallet < selected.principal

  const summary = selected && (
    <>
      <span className="ui-row-sub ui-block">Pay out to {displayName(selected.customer.name)}</span>
      <p className="ag-earn-amount">{formatNaira(selected.principal)}</p>
      <dl className="ag-breakdown">
        <div><dt>Loan</dt><dd className="ag-mono">{selected.ref}</dd></div>
        <div><dt>Interest</dt><dd>{selected.interestRate}% · {selected.durationDays} days</dd></div>
        <div><dt>They repay</dt><dd>{formatNaira(selected.totalAmount)}</dd></div>
        <div><dt>Due</dt><dd>{formatDate(selected.dueDate)}</dd></div>
        <div><dt>Paid in</dt><dd>{method}</dd></div>
        {wallet !== null && <div className="ag-breakdown-total"><dt>Your wallet after</dt><dd className={short ? 'ag-neg' : undefined}>{formatNaira(wallet - selected.principal)}</dd></div>}
      </dl>
      {short && (
        <div className="ui-banner ui-banner--danger" role="alert">
          <Icons.wallet size={18} aria-hidden="true" />
          <div>Your wallet has {formatNaira(wallet ?? 0)}, not enough for this loan. <Link href={`/dashboard/wallet?return=${encodeURIComponent('/dashboard/loan-disburse')}`} className="ag-banner-link">Top up wallet</Link></div>
        </div>
      )}
      <button type="button" className="ui-btn ui-btn--primary ui-btn--block ag-confirm-btn" disabled={!!short || submitting} onClick={() => setConfirming(true)}>
        Pay out {formatNaira(selected.principal, { minor: false })}
      </button>
    </>
  )

  return (
    <div className="ag-page">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      <div className="ag-collect">
        <div className="ag-collect-main">
          <div className="ui-section-head"><h2>Approved, ready to pay out</h2>{loans && loans.length > 0 && <span className="ui-card-meta">{loans.length}</span>}</div>
          <FormError message={error} />
          {loans === null ? (
            <ListSkeleton count={3} />
          ) : loans.length === 0 ? (
            <section className="ui-card">
              <EmptyState icon="loan" title="Nothing to pay out" text="Loans show here once an admin approves them."
                action={<Link href="/dashboard/loan-request" className="ui-btn ui-btn--secondary">Request a loan</Link>} />
            </section>
          ) : (
            <div className="ag-radio-group" role="radiogroup" aria-label="Approved loans">
              {loans.map(l => (
                <button key={l.id} type="button" role="radio" aria-checked={selected?.id === l.id} className="ag-radio ag-loan-pick"
                  onClick={() => { setSelected(selected?.id === l.id ? null : l); setError('') }}>
                  <span className={`ui-avatar ag-av ag-av--${avatarTint(l.customer.customerId)}`} aria-hidden="true">{initials(l.customer.name)}</span>
                  <span className="ag-payee-main">
                    <span className="ui-row-title ui-block">{displayName(l.customer.name)}</span>
                    <span className="ui-row-sub ui-block">{l.ref} · {l.durationDays} days · due {formatDate(l.dueDate)}</span>
                  </span>
                  <span className="ag-pick-amount">{formatNaira(l.principal, { minor: false })}</span>
                  <span className="ui-radio" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          {selected && <section className="ui-card ag-loan-summary ag-loan-summary--inline">{summary}</section>}
        </div>

        <aside className="ag-collect-side ag-loan-side">
          <div className="ui-section-head"><h2>Payout</h2></div>
          <section className="ui-card ag-loan-summary">
            {summary || <EmptyState icon="withdraw" title="Choose a loan" text="Pick an approved loan to see what you’re paying out." />}
          </section>
          <p className="ag-fineprint ag-side-note">Paying out takes the loan amount from your wallet straight away. It can’t be undone.</p>
        </aside>
      </div>

      <BottomSheet open={confirming && !!selected} onClose={() => setConfirming(false)} title="Pay out this loan?">
        {selected && (
          <>
            <p className="ag-sheet-text">
              Give <strong>{displayName(selected.customer.name)}</strong> <strong>{formatNaira(selected.principal)}</strong> in {method.toLowerCase()} now.
              {' '}It comes out of your wallet and can’t be undone.
            </p>
            <div className="ui-stack">
              <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={submitting} onClick={disburse}>
                {submitting ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Paying out…</> : `Yes, pay out ${formatNaira(selected.principal, { minor: false })}`}
              </button>
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={submitting} onClick={() => setConfirming(false)}>Not yet</button>
            </div>
          </>
        )}
      </BottomSheet>
    </div>
  )
}
