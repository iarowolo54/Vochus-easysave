'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { blockMinus, nonNegativeString } from '@/lib/numeric'

interface Customer {
  id: string; customerId: string; firstName: string; lastName: string
  phone: string; savingsBalance: number; activeLoan: any; photoUrl?: string | null
}

interface Rate { id: string; durationDays: number; label: string; rate: number }
interface Loan { ref: string; principal: number; status: string; customer: { name: string } }

export default function LoanRequestPage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [selected, setSelected] = useState<Customer | null>(null)
  const [rates, setRates] = useState<Rate[]>([])
  const [selectedRate, setSelectedRate] = useState<Rate | null>(null)
  const [principal, setPrincipal] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [recentLoans, setRecentLoans] = useState<Loan[]>([])

  useEffect(() => {
    fetch('/api/interest-rates').then(r => r.json()).then(d => {
      setRates(d.rates ?? [])
      if (d.rates?.length) setSelectedRate(d.rates[0])
    })
    fetch('/api/loans?status=Pending,Approved').then(r => r.json()).then(d => setRecentLoans((d.loans ?? []).slice(0, 3)))
  }, [])

  const search = useCallback(async () => {
    if (!query.trim()) { setResults([]); return }
    const res = await fetch(`/api/customers?search=${encodeURIComponent(query)}&limit=5`)
    const data = await res.json()
    setResults(data.customers ?? [])
  }, [query])

  useEffect(() => {
    const t = setTimeout(search, 300)
    return () => clearTimeout(t)
  }, [search])

  const maxLoan = selected ? selected.savingsBalance * 0.8 : 0
  const interest = selectedRate && principal ? (parseFloat(principal) * selectedRate.rate) / 100 : 0
  const total = parseFloat(principal || '0') + interest

  async function submit() {
    if (!selected) { setError('Select a customer first'); return }
    if (!principal || parseFloat(principal) <= 0) { setError('Enter loan amount'); return }
    if (!selectedRate) { setError('Select a duration'); return }
    if (parseFloat(principal) > maxLoan) { setError(`Max loan is ₦${maxLoan.toLocaleString()} (80% of savings)`); return }
    if (selected.activeLoan) { setError('Customer has an active loan'); return }
    setLoading(true); setError('')
    const res = await fetch('/api/loans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: selected.id,
        principal: parseFloat(principal),
        durationDays: selectedRate.durationDays,
        interestRate: selectedRate.rate,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setLoading(false); return }
    setToast(`Loan application submitted: ${data.loan.ref}`)
    setTimeout(() => router.push('/dashboard/loan-disburse'), 2000)
    setLoading(false)
  }

  return (
    <>
      <div className="page-header">
        <h2>Loan Request</h2>
        <p>Submit a new customer loan application for admin approval</p>
      </div>

      {toast && <div className="alert alert-g" style={{ marginBottom: 16 }}>✅ {toast}</div>}
      {error && <div className="alert alert-rd" style={{ marginBottom: 16 }}>🔴 {error}</div>}

      <div className="grid g-2-1">
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Customer Selection</div>
            <div className="isearch" style={{ marginBottom: 10 }}>
              <span className="sicon">🔍</span>
              <input className="finput" type="text" placeholder="Search by name, phone or ID…"
                value={query} onChange={e => { setQuery(e.target.value); setSelected(null) }} />
            </div>
            {results.length > 0 && !selected && (
              <div style={{ border: '1px solid var(--br)', borderRadius: 8 }}>
                {results.map(c => (
                  <div key={c.id} className="lookup-box show" style={{ cursor: 'pointer' }}
                    onClick={() => { setSelected(c); setResults([]); setQuery(`${c.firstName} ${c.lastName}`) }}>
                    {c.photoUrl ? <img src={c.photoUrl} className="av" style={{ objectFit: 'cover', borderRadius: '50%' }} alt="" /> : <div className="av av-g">{c.firstName[0]}{c.lastName[0]}</div>}
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{c.firstName} {c.lastName}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--mu)' }}>{c.customerId} · {c.phone}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--g)', marginTop: 3 }}>
                        Savings: ₦{c.savingsBalance.toLocaleString()} · {c.activeLoan ? '⚠️ Has active loan' : 'Eligible ✅'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selected && (
              <div className="lookup-box show">
                {selected.photoUrl ? <img src={selected.photoUrl} className="av" style={{ objectFit: 'cover', borderRadius: '50%' }} alt="" /> : <div className="av av-g">{selected.firstName[0]}{selected.lastName[0]}</div>}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{selected.firstName} {selected.lastName}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--mu)' }}>{selected.customerId} · {selected.phone}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--g)', marginTop: 3 }}>
                    Savings: ₦{selected.savingsBalance.toLocaleString()} · Max loan: ₦{maxLoan.toLocaleString()} · {selected.activeLoan ? '⚠️ Has active loan' : 'Eligible ✅'}
                  </div>
                </div>
                <button className="btn btn-out btn-sm" onClick={() => { setSelected(null); setQuery('') }}>✕</button>
              </div>
            )}
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Loan Details</div>
            {selected && (
              <div className="alert alert-b">ℹ️ Maximum loan = 80% of savings. {selected.firstName}: max ₦{maxLoan.toLocaleString()}</div>
            )}
            <div className="form-row fr2">
              <div><label className="flabel">Loan Amount (₦) *</label>
                <input className="finput" type="tel" inputMode="decimal" onKeyDown={blockMinus} placeholder="10,000" value={principal} onChange={e => setPrincipal(nonNegativeString(e.target.value))} />
              </div>
              <div><label className="flabel">Duration *</label>
                <select className="finput" onChange={e => setSelectedRate(rates.find(r => r.id === e.target.value) ?? null)}>
                  {rates.map(r => (
                    <option key={r.id} value={r.id}>{r.label} — {r.rate}%</option>
                  ))}
                </select>
              </div>
            </div>
            {principal && selectedRate && (
              <div className="conf-table" style={{ marginTop: 12 }}>
                <div className="conf-row"><span className="conf-lbl">Interest ({selectedRate.rate}%)</span><strong style={{ color: 'var(--gd)' }}>₦{interest.toLocaleString()}</strong></div>
                <div className="conf-row"><span className="conf-lbl">Total Repayable</span><strong style={{ color: 'var(--gd)', fontSize: 16 }}>₦{total.toLocaleString()}</strong></div>
              </div>
            )}
          </div>
          <div className="btn-row">
            <button className="btn btn-out">Cancel</button>
            <button className="btn btn-pu" disabled={loading} onClick={submit}>
              {loading ? '⏳ Submitting…' : '📤 Submit Application'}
            </button>
          </div>
        </div>
        <div>
          <div className="sec-label" style={{ marginTop: 0 }}>Recent Applications</div>
          <div className="card" style={{ marginBottom: 16 }}>
            {recentLoans.length === 0 && <div style={{ textAlign: 'center', color: 'var(--mu)', fontSize: 13, padding: 12 }}>No recent applications</div>}
            {recentLoans.map((l, i) => (
              <div key={l.ref} className="cust-row" style={{ padding: '9px 0', borderBottom: i < recentLoans.length - 1 ? undefined : 'none' }}>
                <div className="av av-g">{l.customer.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
                <div><div className="cust-name">{l.customer.name}</div><div className="cust-sub">{l.ref} · ₦{l.principal.toLocaleString()}</div></div>
                <span className={`bdg ${l.status === 'Approved' ? 'bdg-g' : l.status === 'Pending' ? 'bdg-gd' : 'bdg-rd'}`} style={{ marginLeft: 'auto' }}>{l.status}</span>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-title">Eligibility Rules</div>
            <div style={{ fontSize: 12.5, color: 'var(--mu)', lineHeight: 1.9 }}>
              • Max 80% of savings balance<br />• No existing active loan<br />• Min 30 days of saving history<br />• No overdue repayments<br />• Admin approval required
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
