'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'

interface Loan {
  id: string; ref: string; principal: number; interestRate: number; totalAmount: number
  durationDays: number; dueDate: string; status: string
  customer: { id: string; name: string; customerId: string; phone: string }
}

export default function LoanDisbursePage() {
  const router = useRouter()
  const { update } = useSession()
  const [loans, setLoans] = useState<Loan[]>([])
  const [selected, setSelected] = useState<Loan | null>(null)
  const [method, setMethod] = useState('Cash')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/loans?status=Approved')
      .then(r => r.json())
      .then(d => { setLoans(d.loans ?? []); setLoading(false) })
  }, [toast])

  async function disburse() {
    if (!selected) { setError('Select a loan first'); return }
    setSubmitting(true); setError('')
    const res = await fetch(`/api/loans/${selected.id}/disburse`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setSubmitting(false); return }
    setToast(`₦${selected.principal.toLocaleString()} disbursed to ${selected.customer.name}`)
    setSelected(null)
    setSubmitting(false)
    update()
    setTimeout(() => setToast(''), 4000)
  }

  const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2)

  return (
    <>
      <div className="page-header">
        <h2>Loan Disbursement</h2>
        <p>Release approved loans to customers</p>
      </div>

      {toast && <div className="alert alert-g" style={{ marginBottom: 16 }}>✅ {toast}</div>}
      {error && <div className="alert alert-rd" style={{ marginBottom: 16 }}>🔴 {error}</div>}
      <div className="alert alert-g" style={{ marginBottom: 18 }}>✅ Only admin-approved loans can be disbursed. Pending loans are awaiting superadmin review.</div>

      <div className="grid g-2-1">
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Loans Awaiting Disbursement</div>
            {loading && <div style={{ textAlign: 'center', color: 'var(--mu)', padding: 16 }}>Loading…</div>}
            {!loading && loans.length === 0 && <div style={{ textAlign: 'center', color: 'var(--mu)', padding: 16 }}>No loans pending disbursement</div>}
            {!loading && loans.map(l => (
              <div
                key={l.id}
                className={`sel-item${selected?.id === l.id ? ' on' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(selected?.id === l.id ? null : l)}
              >
                <div className="av av-rd">{initials(l.customer.name)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--txt)' }}>{l.customer.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--mu)' }}>
                    {l.ref} · {l.durationDays} Days · {l.interestRate}% · Due {new Date(l.dueDate).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 16, fontWeight: 800, color: 'var(--g)' }}>
                    ₦{l.principal.toLocaleString()}
                  </div>
                  <span className={`bdg ${l.status === 'Approved' ? 'bdg-g' : 'bdg-gd'}`} style={{ fontSize: 10 }}>{l.status}</span>
                </div>
                <div className={`sel-radio${selected?.id === l.id ? ' on' : ''}`}>{selected?.id === l.id ? '✓' : ''}</div>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Disbursement Method</div>
            {[
              { icon: '💵', label: 'Cash in Hand', desc: 'Immediate physical handover', val: 'Cash' },
            ].map(m => (
              <div key={m.val} className={`sel-item${method === m.val ? ' on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setMethod(m.val)}>
                <div style={{ fontSize: 22 }}>{m.icon}</div>
                <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{m.label}</div><div style={{ fontSize: 12, color: 'var(--mu)' }}>{m.desc}</div></div>
                <div className={`sel-radio${method === m.val ? ' on' : ''}`}>{method === m.val ? '✓' : ''}</div>
              </div>
            ))}
          </div>
          <div className="btn-row">
            <button className="btn btn-out">Cancel</button>
            <button className="btn btn-b" disabled={submitting || !selected} onClick={disburse}>
              {submitting ? '⏳ Disbursing…' : '💸 Disburse Now'}
            </button>
          </div>
        </div>
        <div>
          <div className="card">
            <div className="card-title">Disbursement Summary</div>
            {selected ? (
              <>
                <div className="conf-table">
                  <div className="conf-row"><span className="conf-lbl">Customer</span><span className="conf-val">{selected.customer.name}</span></div>
                  <div className="conf-row"><span className="conf-lbl">Loan Ref</span><strong style={{ color: 'var(--b)' }}>{selected.ref}</strong></div>
                  <div className="conf-row"><span className="conf-lbl">Disbursing</span><strong style={{ color: 'var(--g)', fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 18 }}>₦{selected.principal.toLocaleString()}</strong></div>
                  <div className="conf-row"><span className="conf-lbl">Total Repayable</span><strong style={{ color: 'var(--gd)' }}>₦{selected.totalAmount.toLocaleString()}</strong></div>
                  <div className="conf-row"><span className="conf-lbl">Due Date</span><strong>{new Date(selected.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div>
                </div>
                <div className="alert alert-rd" style={{ marginTop: 10 }}>🔴 Funds deducted immediately. Cannot be reversed.</div>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--mu)', fontSize: 13, padding: 16 }}>Select a loan to see summary</div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
