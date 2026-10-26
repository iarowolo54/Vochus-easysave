'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { blockMinus, nonNegativeString } from '@/lib/numeric'

interface Loan {
  id: string; ref: string; principal: number; interestAmount: number; totalAmount: number
  durationDays: number; dueDate: string; status: string; repaid: number
  customer: { id: string; name: string; customerId: string }
}

export default function LoanRepayPage() {
  return <Suspense><LoanRepayContent /></Suspense>
}

function LoanRepayContent() {
  const { update } = useSession()
  const searchParams = useSearchParams()
  const [loans, setLoans] = useState<Loan[]>([])
  const [selected, setSelected] = useState<Loan | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('Cash')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const loadLoans = async () => {
    setLoading(true)
    const res = await fetch('/api/loans?status=Disbursed,Approved')
    const data = await res.json()
    setLoans(data.loans ?? [])
    setLoading(false)
  }

  useEffect(() => { loadLoans() }, [toast])

  useEffect(() => {
    const cid = searchParams.get('cid')
    if (!cid || loans.length === 0) return
    const match = loans.find(l => l.customer.customerId === cid)
    if (match) { setSelected(match); setQuery(match.customer.name) }
  }, [loans, searchParams])

  const filtered = query
    ? loans.filter(l =>
        l.customer.name.toLowerCase().includes(query.toLowerCase()) ||
        l.ref.toLowerCase().includes(query.toLowerCase()) ||
        l.customer.customerId.toLowerCase().includes(query.toLowerCase())
      )
    : loans

  const outstanding = selected ? selected.totalAmount - selected.repaid : 0

  async function submit() {
    if (!selected) { setError('Select a loan first'); return }
    if (!amount || parseFloat(amount) <= 0) { setError('Enter a valid amount'); return }
    setSubmitting(true); setError('')
    const res = await fetch(`/api/loans/${selected.id}/repay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: parseFloat(amount), method }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setSubmitting(false); return }
    setToast(`₦${parseFloat(amount).toLocaleString()} repayment recorded for ${selected.customer.name}${data.fullyRepaid ? ' — Loan fully repaid! 🎉' : ''}`)
    setSelected(null); setAmount('')
    setSubmitting(false)
    update()
    setTimeout(() => setToast(''), 5000)
  }

  const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2)

  return (
    <>
      <div className="page-header">
        <h2>Record Repayment</h2>
        <p>Collect and record customer loan repayments</p>
      </div>

      {toast && <div className="alert alert-g" style={{ marginBottom: 16 }}>✅ {toast}</div>}
      {error && <div className="alert alert-rd" style={{ marginBottom: 16 }}>🔴 {error}</div>}

      <div className="grid g-2-1">
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Active Loans</div>
            <div className="isearch" style={{ marginBottom: 12 }}>
              <span className="sicon">🔍</span>
              <input className="finput" type="text" placeholder="Name, phone or loan ref…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            {loading && <div style={{ textAlign: 'center', color: 'var(--mu)', padding: 12 }}>Loading…</div>}
            {!loading && filtered.length === 0 && <div style={{ textAlign: 'center', color: 'var(--mu)', padding: 12 }}>No active loans found</div>}
            {!loading && filtered.map(l => {
              const out = l.totalAmount - l.repaid
              const due = new Date(l.dueDate)
              const isOverdue = due < new Date()
              return (
                <div
                  key={l.id}
                  className={`sel-item${selected?.id === l.id ? ' on' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelected(selected?.id === l.id ? null : l)}
                >
                  <div className="av av-rd">{initials(l.customer.name)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{l.customer.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--mu)' }}>
                      {l.ref} · Due {due.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} · {l.durationDays} days
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800, color: isOverdue ? 'var(--rd)' : 'var(--gd)' }}>
                      ₦{out.toLocaleString()}
                    </div>
                    <span className={`bdg ${isOverdue ? 'bdg-rd' : 'bdg-gd'}`} style={{ fontSize: 10 }}>
                      {isOverdue ? 'Overdue' : 'Active'}
                    </span>
                  </div>
                  <div className={`sel-radio${selected?.id === l.id ? ' on' : ''}`}>{selected?.id === l.id ? '✓' : ''}</div>
                </div>
              )
            })}
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Payment Details</div>
            <label className="flabel">Amount Received (₦) *</label>
            <input
              className="finput" type="tel" inputMode="decimal" onKeyDown={blockMinus} placeholder="Enter amount"
              style={{ fontSize: 28, fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800, textAlign: 'center', padding: 14, marginBottom: 14 }}
              value={amount} onChange={e => setAmount(nonNegativeString(e.target.value))}
            />
            <div className="form-row fr2">
              <div><label className="flabel">Payment Method</label>
                <select className="finput" value={method} onChange={e => setMethod(e.target.value)}>
                  <option>Cash</option>
                </select>
              </div>
            </div>
          </div>
          <div className="btn-row">
            <button className="btn btn-out" onClick={() => { setSelected(null); setAmount('') }}>Cancel</button>
            <button className="btn btn-g" disabled={submitting || !selected} onClick={submit}>
              {submitting ? '⏳ Recording…' : '✓ Record Repayment'}
            </button>
          </div>
        </div>
        <div>
          {selected ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Loan Summary</div>
              <div className="conf-table">
                <div className="conf-row"><span className="conf-lbl">Customer</span><strong>{selected.customer.name}</strong></div>
                <div className="conf-row"><span className="conf-lbl">Loan Ref</span><strong style={{ color: 'var(--b)' }}>{selected.ref}</strong></div>
                <div className="conf-row"><span className="conf-lbl">Principal</span><strong style={{ color: 'var(--txt)' }}>₦{selected.principal.toLocaleString()}</strong></div>
                <div className="conf-row"><span className="conf-lbl">Interest</span><strong style={{ color: 'var(--gd)' }}>₦{selected.interestAmount.toLocaleString()}</strong></div>
                <div className="conf-row"><span className="conf-lbl">Total</span><strong>₦{selected.totalAmount.toLocaleString()}</strong></div>
                <div className="conf-row"><span className="conf-lbl">Repaid</span><strong style={{ color: 'var(--g)' }}>₦{selected.repaid.toLocaleString()}</strong></div>
                <div className="conf-row"><span className="conf-lbl">Outstanding</span><strong style={{ color: 'var(--rd)', fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 18 }}>₦{outstanding.toLocaleString()}</strong></div>
                <div className="conf-row"><span className="conf-lbl">Due Date</span><strong style={{ color: new Date(selected.dueDate) < new Date() ? 'var(--rd)' : 'inherit' }}>{new Date(selected.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div>
              </div>
            </div>
          ) : (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ textAlign: 'center', color: 'var(--mu)', fontSize: 13, padding: 24 }}>Select a loan to see details</div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
