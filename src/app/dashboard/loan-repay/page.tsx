'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import AmountField from '@/components/ui/AmountField'
import EmptyState from '@/components/ui/EmptyState'
import { FormError } from '@/components/ui/FormErrors'
import { ListSkeleton } from '@/components/ui/Skeleton'
import Toast from '@/components/ui/Toast'
import { Icons } from '@/components/ui/icons'
import { avatarTint } from '@/lib/avatar'
import { displayName, formatDate, formatNaira } from '@/lib/format'

interface Loan {
  id: string; ref: string; principal: number; interestAmount: number; totalAmount: number
  durationDays: number; dueDate: string; status: string; repaid: number
  customer: { id: string; name: string; customerId: string }
}

const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

function dueText(iso: string) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} overdue`, overdue: true }
  if (days === 0) return { text: 'Due today', overdue: false }
  return { text: `Due in ${days} day${days === 1 ? '' : 's'}`, overdue: false }
}

export default function LoanRepayPage() {
  return <Suspense><LoanRepayContent /></Suspense>
}

function LoanRepayContent() {
  const { update } = useSession()
  const searchParams = useSearchParams()
  const [loans, setLoans] = useState<Loan[] | null>(null)
  const [selected, setSelected] = useState<Loan | null>(null)
  const [amount, setAmount] = useState('')
  const [method] = useState('Cash')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const loadLoans = useCallback(async () => {
    try {
      const res = await fetch('/api/loans?status=Disbursed,Approved')
      const data = await res.json()
      setLoans(data.loans ?? [])
    } catch {
      setLoans(prev => prev ?? [])
    }
  }, [])

  useEffect(() => { loadLoans() }, [loadLoans, refreshKey])

  useEffect(() => {
    const cid = searchParams.get('cid')
    if (!cid || !loans || loans.length === 0) return
    const match = loans.find(l => l.customer.customerId === cid)
    if (match) setSelected(match)
  }, [loans, searchParams])

  const q = query.trim().toLowerCase()
  const filtered = (loans ?? []).filter(l => !q
    || l.customer.name.toLowerCase().includes(q)
    || l.ref.toLowerCase().includes(q)
    || l.customer.customerId.toLowerCase().includes(q))

  const outstanding = selected ? selected.totalAmount - selected.repaid : 0
  const amt = parseFloat(amount || '0')
  const tooMuch = amt > outstanding + 0.005

  async function submit() {
    if (!selected) { setError('Choose a loan first.'); return }
    if (!amount || amt <= 0) { setError('Enter the amount you received.'); return }
    if (tooMuch) { setError(`That’s more than the ${formatNaira(outstanding)} still owed.`); return }
    setSubmitting(true); setError('')
    try {
      const res = await fetch(`/api/loans/${selected.id}/repay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, method }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'The repayment didn’t go through. Please try again.'); setSubmitting(false); return }
      setToast(data.fullyRepaid
        ? `${displayName(selected.customer.name)}’s loan is fully repaid`
        : `${formatNaira(amt, { minor: false })} recorded for ${displayName(selected.customer.name)}`)
      setSelected(null); setAmount('')
      setRefreshKey(k => k + 1)
      update()
    } catch {
      setError('We lost the connection. Check the loan’s balance before trying again, so it isn’t recorded twice.')
      setRefreshKey(k => k + 1)
    }
    setSubmitting(false)
  }

  return (
    <div className="ag-page">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      <div className="ag-collect">
        <div className="ag-collect-main">
          {!selected ? (
            <>
              <div className="ui-section-head"><h2>Loans being repaid</h2>{loans && loans.length > 0 && <span className="ui-card-meta">{loans.length}</span>}</div>
              <div className="ag-search ag-cal-search">
                <Icons.search size={20} aria-hidden="true" />
                <input className="ui-input" type="search" autoComplete="off" placeholder="Name, customer ID or loan reference" aria-label="Search loans" value={query} onChange={e => setQuery(e.target.value)} />
              </div>
              {loans === null ? (
                <ListSkeleton count={4} />
              ) : filtered.length === 0 ? (
                <section className="ui-card"><EmptyState icon="repay" title={q ? 'No loans match' : 'No loans to repay'} text={q ? 'Try another name or reference.' : 'Loans you pay out show here until they’re fully repaid.'} /></section>
              ) : (
                <section className="ui-card ui-card--list">
                  {filtered.map(l => {
                    const out = l.totalAmount - l.repaid
                    const pct = l.totalAmount > 0 ? Math.round((l.repaid / l.totalAmount) * 100) : 0
                    const due = dueText(l.dueDate)
                    return (
                      <button key={l.id} type="button" className="ag-crow" onClick={() => { setSelected(l); setAmount(''); setError('') }}>
                        <span className={`ui-avatar ag-av ag-av--${avatarTint(l.customer.customerId)}`} aria-hidden="true">{initials(l.customer.name)}</span>
                        <span className="ag-crow-main">
                          <span className="ag-crow-name">{displayName(l.customer.name)}</span>
                          <span className="ag-crow-sub">{l.ref}</span>
                          <span className="ag-crow-plan">
                            <span className="ag-mini-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                            <span className="ag-crow-plan-text">{pct}% repaid</span>
                          </span>
                        </span>
                        <span className="ag-crow-end">
                          <span className="ag-crow-bal">{formatNaira(out, { minor: false })}</span>
                          <span className={`ag-crow-tag${due.overdue ? ' ag-crow-tag--due' : ''}`}>{due.text}</span>
                        </span>
                      </button>
                    )
                  })}
                </section>
              )}
            </>
          ) : (
            <div className="ag-panel">
              <header className="ag-flow-head ag-panel-head">
                <div className="ag-flow-nav">
                  <button type="button" className="ui-icon-btn ui-icon-btn--soft" aria-label="Back to loans" onClick={() => { setSelected(null); setAmount(''); setError('') }}><Icons.back size={20} aria-hidden="true" /></button>
                  <span className="ag-flow-count">Record a repayment</span>
                  <span className="ag-flow-nav-gap" />
                </div>
              </header>
              <div className="ag-flow-body">
                <div className="ag-who">
                  <span className={`ui-avatar ag-av ag-av--${avatarTint(selected.customer.customerId)}`} aria-hidden="true">{initials(selected.customer.name)}</span>
                  <div className="ag-payee-main">
                    <p className="ui-row-title">{displayName(selected.customer.name)}</p>
                    <p className="ui-row-sub">{selected.ref} · {dueText(selected.dueDate).text}</p>
                  </div>
                </div>

                <h2 className="ag-q ag-q--amount"><span className="ag-q-kicker">Still owed</span>{formatNaira(outstanding)}</h2>
                <div className="ui-progress ag-repay-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100}
                  aria-valuenow={Math.round((selected.repaid / selected.totalAmount) * 100)} aria-label="Repaid so far">
                  <span style={{ width: `${Math.min(100, (selected.repaid / selected.totalAmount) * 100)}%` }} />
                </div>
                <p className="ui-row-sub">{formatNaira(selected.repaid, { minor: false })} repaid of {formatNaira(selected.totalAmount, { minor: false })}</p>

                <p className="ag-label">How much did they pay?</p>
                <AmountField value={amount} onChange={v => { setAmount(v); setError('') }} invalid={tooMuch}
                  hint={tooMuch ? `More than the ${formatNaira(outstanding, { minor: false })} still owed` : 'Cash you received from the customer'} />
                <div className="ag-quick">
                  <button type="button" className="ag-chip" aria-pressed={Math.abs(amt - outstanding) < 0.005} onClick={() => setAmount(String(Math.round(outstanding * 100) / 100))}>
                    All of it · {formatNaira(outstanding, { minor: false })}
                  </button>
                </div>

                <dl className="ag-breakdown">
                  <div><dt>Loan</dt><dd>{formatNaira(selected.principal)}</dd></div>
                  <div><dt>Interest</dt><dd>{formatNaira(selected.interestAmount)}</dd></div>
                  <div><dt>Due</dt><dd>{formatDate(selected.dueDate)}</dd></div>
                  <div><dt>Paid in</dt><dd>{method}</dd></div>
                  {amt > 0 && !tooMuch && <div className="ag-breakdown-total"><dt>Left to pay after this</dt><dd>{formatNaira(outstanding - amt)}</dd></div>}
                </dl>

                <FormError message={error} />
                <div className="ag-flow-actions">
                  <button type="button" className="ui-btn ui-btn--primary ag-flow-cta" disabled={submitting || !amt || tooMuch} onClick={submit}>
                    {submitting ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Recording…</> : amt > 0 ? `Record ${formatNaira(amt, { minor: false })}` : 'Record repayment'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="ag-collect-side">
          <div className="ui-section-head"><h2>About repayments</h2></div>
          <ul className="ag-rules">
            <li><Icons.check size={16} aria-hidden="true" /> Customers can repay in parts, as often as they like</li>
            <li><Icons.check size={16} aria-hidden="true" /> A repayment can’t be more than what’s still owed</li>
            <li><Icons.check size={16} aria-hidden="true" /> The cash you record is added to your wallet</li>
          </ul>
        </aside>
      </div>
    </div>
  )
}
