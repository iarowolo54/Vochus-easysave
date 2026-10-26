'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface Withdrawal {
  id: string
  ref: string
  amount: number
  status: string
  note: string | null
  bankName: string | null
  accountNumber: string | null
  accountName: string | null
  bankTransferStatus: string | null
  adminNote: string | null
  requestedAt: string
  decidedAt: string | null
  decidedBy: string | null
}

interface Bank {
  bankCode?: string
  bankName?: string
  accountNumber?: string
  accountName?: string
}

const fmt = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 0 })}`
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function WithdrawPage() {
  const [commissionBalance, setCommissionBalance] = useState(0)
  const [bank, setBank] = useState<Bank | null>(null)
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [minWithdrawal, setMinWithdrawal] = useState(500)
  const [loading, setLoading] = useState(true)

  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/agent/withdrawal')
    if (res.ok) {
      const d = await res.json()
      setCommissionBalance(d.commissionBalance ?? 0)
      setBank(d.bank ?? null)
      setWithdrawals(d.withdrawals ?? [])
      setMinWithdrawal(d.minWithdrawal ?? 500)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const hasPending = withdrawals.some(w => ['Pending', 'AwaitingOTP'].includes(w.status))

  async function submit() {
    setError('')
    const amt = parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter a valid amount'); return }
    if (amt > commissionBalance) { setError('Amount exceeds your commission balance'); return }
    setSubmitting(true)
    const res = await fetch('/api/agent/withdrawal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amt, note }),
    })
    setSubmitting(false)
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setError(d.error ?? 'Failed to submit request'); return }
    setAmount(''); setNote('')
    setToast('Withdrawal request submitted. Awaiting super admin approval.')
    setTimeout(() => setToast(''), 4500)
    load()
  }

  const statusBadge = (s: string) => {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      Pending:      { bg: '#fff3e0', color: '#e67e22', label: '⏳ Pending' },
      AwaitingOTP:  { bg: '#e8f0fb', color: '#1a5fa8', label: '📩 Awaiting OTP' },
      Approved:     { bg: '#dcfce7', color: '#16a34a', label: '✅ Approved' },
      Rejected:     { bg: '#fde2e1', color: '#c0392b', label: '❌ Rejected' },
    }
    const s2 = map[s] ?? { bg: '#f1f5f9', color: '#64748b', label: s }
    return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: s2.bg, color: s2.color }}>{s2.label}</span>
  }

  return (
    <>
      <div className="page-header">
        <h2>Withdraw Commission</h2>
        <p>Cash out your accrued commission to your bank account</p>
      </div>

      {toast && <div className="alert alert-g" style={{ marginBottom: 16 }}>✅ {toast}</div>}

      {loading && <div style={{ textAlign: 'center', color: 'var(--mu)', padding: 24 }}>Loading…</div>}

      {!loading && (
        <div className="grid g-2-1">
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Request Withdrawal</div>

              {!bank?.accountNumber ? (
                <div className="alert" style={{ background: '#fff3e0', color: '#c0392b', border: '1px solid #f5c6c6', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
                  ⚠️ Add your payout bank account first. <Link href="/dashboard/settings" style={{ color: '#c0392b', fontWeight: 700 }}>Go to Settings →</Link>
                </div>
              ) : (
                <div style={{ background: '#f8fafc', border: '1px solid var(--bdr)', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13 }}>
                  <div style={{ fontSize: 11, color: 'var(--mu)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>Payout Account</div>
                  <div style={{ fontWeight: 700, color: 'var(--text)' }}>{bank.accountName ?? '—'}</div>
                  <div style={{ color: 'var(--mu)' }}>{bank.bankName} · {bank.accountNumber}</div>
                </div>
              )}

              {hasPending && (
                <div className="alert" style={{ background: '#e8f0fb', color: '#1a5fa8', border: '1px solid #1a5fa8', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
                  ℹ️ You have a pending withdrawal. Wait for admin decision before requesting another.
                </div>
              )}

              {error && <div className="alert alert-rd" style={{ marginBottom: 12 }}>🔴 {error}</div>}

              <div className="form-row">
                <label className="flabel">Amount (₦)</label>
                <input
                  className="finput"
                  inputMode="decimal"
                  placeholder="Enter amount"
                  value={amount}
                  onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  disabled={hasPending || !bank?.accountNumber}
                />
                <div style={{ fontSize: 12, color: 'var(--mu)', marginTop: 4 }}>
                  Available: <strong style={{ color: 'var(--g)' }}>{fmt(commissionBalance)}</strong>
                  {commissionBalance > 0 && (
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: 'var(--b)', fontSize: 12, cursor: 'pointer', marginLeft: 8, fontWeight: 600 }}
                      onClick={() => setAmount(commissionBalance.toFixed(2))}
                    >
                      Withdraw all
                    </button>
                  )}
                </div>
              </div>

              <div className="form-row">
                <label className="flabel">Note (optional)</label>
                <textarea
                  className="finput"
                  rows={2}
                  placeholder="Anything the admin should know…"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  disabled={hasPending || !bank?.accountNumber}
                  style={{ resize: 'vertical' }}
                />
              </div>

              <button
                className="btn btn-g btn-sm"
                disabled={submitting || hasPending || !bank?.accountNumber || !amount}
                onClick={submit}
              >
                {submitting ? '⏳ Submitting…' : '💸 Submit Withdrawal Request'}
              </button>
            </div>

            <div className="card">
              <div className="card-title">Withdrawal History</div>
              {withdrawals.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--mu)', fontSize: 13, padding: 12 }}>No withdrawals yet</div>
              )}
              {withdrawals.map((w, i) => (
                <div key={w.id} style={{ padding: '12px 0', borderBottom: i < withdrawals.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, fontSize: 13, color: 'var(--b)' }}>{w.ref}</div>
                    {statusBadge(w.status)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{fmt(w.amount)}</div>
                      <div style={{ fontSize: 11, color: 'var(--mu)' }}>{w.bankName} · ****{w.accountNumber?.slice(-4)}</div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--mu)', textAlign: 'right' }}>
                      Requested: {fmtDate(w.requestedAt)}
                      {w.decidedAt && <><br />Decided: {fmtDate(w.decidedAt)} by {w.decidedBy}</>}
                    </div>
                  </div>
                  {w.adminNote && (
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--mu)', fontStyle: 'italic' }}>Admin note: {w.adminNote}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Commission Balance</div>
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 11, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: 1 }}>Available for withdrawal</div>
                <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 34, fontWeight: 800, color: 'var(--g)', margin: '8px 0' }}>
                  {fmt(commissionBalance)}
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-title">How it works</div>
              <ol style={{ fontSize: 13, color: 'var(--mu)', paddingLeft: 20, lineHeight: 1.7, margin: 0 }}>
                <li>Add your payout bank in Settings.</li>
                <li>Request a withdrawal — funds are held from your balance.</li>
                <li>Super admin reviews and approves.</li>
                <li>Paystack transfers to your bank on approval.</li>
                <li>If rejected, the amount returns to your commission balance.</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
