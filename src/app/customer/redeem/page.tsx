'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import BankPicker from '@/components/BankPicker'

type Bank = { code: string; name: string }
type Redemption = {
  id: string; ref: string; status: string; balance: number; penalty: number
  netPayout: number; requestedAt: string; token?: string; tokenExpiry?: string
  reason: string; type: string
}

export default function CustomerRedeemPage() {
  const router = useRouter()
  const [plan, setPlan] = useState<any>(null)
  const [redemptions, setRedemptions] = useState<Redemption[]>([])
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<'idle' | 'form' | 'token' | 'done' | 'resume-token' | 'awaiting'>('idle')
  const [reason, setReason] = useState('')
  const [useBankTransfer, setUseBankTransfer] = useState(false)
  const [banks, setBanks] = useState<Bank[]>([])
  const [bankCode, setBankCode] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [bankName, setBankName] = useState('')
  const [resolving, setResolving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [token, setToken] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [currentRef, setCurrentRef] = useState('')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [selectedRedemption, setSelectedRedemption] = useState<Redemption | null>(null)

  useEffect(() => {
    fetch('/api/customer/me')
      .then(r => { if (r.status === 401) { router.push('/customer/login'); return null } return r.json() })
      .then(d => { if (d) setPlan(d.plan) })

    fetch('/api/customer/redeem')
      .then(r => r.json())
      .then(d => { if (d.redemptions) setRedemptions(d.redemptions) })
      .finally(() => setLoading(false))

    fetch('/api/paystack/banks')
      .then(r => r.json())
      .then(d => { if (d.banks) setBanks(d.banks) })
  }, [])

  async function resolveAccount(acctNum = accountNumber) {
    if (!acctNum || acctNum.length < 10 || !bankCode) return
    setResolving(true)
    setAccountName('')
    try {
      const res = await fetch(`/api/paystack/resolve-account?accountNumber=${acctNum}&bankCode=${bankCode}`)
      const data = await res.json()
      if (data.accountName) {
        setAccountName(data.accountName)
        const b = banks.find(b => b.code === bankCode)
        setBankName(b?.name ?? '')
      }
    } catch {}
    finally { setResolving(false) }
  }

  async function submitRequest() {
    setError('')
    if (!reason) { setError('Enter a reason for redemption'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/customer/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          ...(useBankTransfer && accountNumber && accountName ? { accountNumber, accountName, bankCode, bankName } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      setToken(data.token)
      setCurrentRef(data.ref)
      setResult(data)
      setStep('token')
    } catch { setError('Network error') }
    finally { setSubmitting(false) }
  }

  async function validateToken() {
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/customer/redeem', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: currentRef, token: tokenInput }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Invalid token'); return }
      setStep('done')
      const updated = redemptions.map(r => r.ref === currentRef ? { ...r, status: 'TokenValidated' } : r)
      setRedemptions(updated)
    } catch { setError('Network error') }
    finally { setSubmitting(false) }
  }

  function openRedemption(r: Redemption) {
    setError('')
    setTokenInput('')
    setSelectedRedemption(r)
    if (r.status === 'Pending') {
      setCurrentRef(r.ref)
      setToken(r.token ?? '')
      setStep('resume-token')
    } else {
      setStep('awaiting')
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ width: 36, height: 36, border: '3px solid var(--gl)', borderTop: '3px solid var(--g)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const hasCash = !!plan?.hasCashDeposit
  const isEarly = plan ? new Date() < new Date(plan.maturityDate) : false
  let savingsFee = 0
  if (plan) {
    if (hasCash && plan.cadence !== 'weekly') {
      savingsFee = Math.min(plan.dailyAmount, plan.balance)
    } else {
      const totalRate = plan.cadence === 'weekly'
        ? (hasCash ? 0.075 : 0.035)
        : 0.025
      savingsFee = Math.round(plan.balance * totalRate * 100) / 100
    }
  }
  const netPayout = plan ? plan.balance - savingsFee : 0

  const statusColor = (s: string) => {
    if (s === 'Approved') return { bg: 'var(--gl)', col: 'var(--g)' }
    if (s === 'Rejected') return { bg: 'var(--rdl)', col: 'var(--rd)' }
    if (s === 'TokenValidated' || s === 'AgentApproved') return { bg: 'var(--bl)', col: 'var(--b)' }
    return { bg: 'var(--gdl)', col: 'var(--gd)' }
  }

  const statusLabel = (s: string) => {
    if (s === 'TokenValidated') return 'Pending Review'
    if (s === 'AgentApproved') return 'Agent Approved'
    return s
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 80 }}>
      <div style={{
        position: 'sticky', top: 0, height: 56, zIndex: 200,
        background: 'linear-gradient(135deg,#071a0e,#0e4d24)',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
      }}>
        <button onClick={() => {
          if (step !== 'idle') { setStep('idle'); setError(''); setTokenInput('') }
          else router.push('/customer/dashboard')
        }} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: 0 }}>←</button>
        <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff' }}>Redeem Savings</div>
      </div>

      <div style={{ padding: 16 }}>
        {step === 'done' ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--gm)', borderRadius: 18, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 20, fontWeight: 900, color: 'var(--g)', marginBottom: 8 }}>Request Submitted!</div>
            <div style={{ fontSize: 13, color: 'var(--mu)', lineHeight: 1.6, marginBottom: 16 }}>
              Your token has been validated. Your agent will review and approve your request, followed by final admin approval. You will be notified once the transfer is initiated.
            </div>
            {result && (
              <div style={{ background: 'var(--gl)', borderRadius: 10, padding: '12px 14px', marginBottom: 16, textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 6 }}>
                  <span style={{ color: 'var(--mu)' }}>Balance</span>
                  <strong>₦{result.balance?.toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800 }}>
                  <span style={{ color: 'var(--g)' }}>You Receive</span>
                  <span style={{ color: 'var(--g)' }}>₦{result.netPayout?.toLocaleString()}</span>
                </div>
              </div>
            )}
            <button onClick={() => router.push('/customer/dashboard')} style={{ width: '100%', padding: 14, background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)', border: 'none', borderRadius: 12, cursor: 'pointer', fontFamily: 'Plus Jakarta Sans', fontSize: 14, fontWeight: 800, color: '#fff' }}>
              Back to Dashboard
            </button>
          </div>

        ) : step === 'awaiting' && selectedRedemption ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 16, padding: 20 }}>
            <div style={{ textAlign: 'center', padding: '12px 0 20px' }}>
              <div style={{ fontSize: 52, marginBottom: 10 }}>⏳</div>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 18, fontWeight: 900, marginBottom: 6 }}>
                {selectedRedemption.status === 'AgentApproved' ? 'Awaiting Admin Approval' : 'Awaiting Confirmation'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--mu)', lineHeight: 1.6 }}>
                {selectedRedemption.status === 'AgentApproved'
                  ? 'Your agent has approved this request. It is now pending final admin confirmation before payout.'
                  : 'Your redemption request has been received and is being reviewed by your agent. You will be notified once approved.'}
              </div>
            </div>
            <div style={{ background: 'var(--gl)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: 'var(--mu)' }}>Reference</span>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--mu)' }}>{selectedRedemption.ref}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: 'var(--mu)' }}>Amount</span>
                <strong>₦{selectedRedemption.netPayout?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--mu)' }}>Requested</span>
                <span>{new Date(selectedRedemption.requestedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              </div>
            </div>
            {(() => {
              const { bg, col } = statusColor(selectedRedemption.status)
              return (
                <div style={{ background: bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: col }}>
                  {statusLabel(selectedRedemption.status)}
                </div>
              )
            })()}
            <button onClick={() => { setStep('idle'); setSelectedRedemption(null) }} style={{
              width: '100%', marginTop: 14, padding: 13, background: 'var(--card)',
              border: '1.5px solid var(--br)', borderRadius: 12, cursor: 'pointer',
              fontSize: 14, fontWeight: 700,
            }}>← Back</button>
          </div>

        ) : (step === 'token' || step === 'resume-token') ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>🔐 Enter Your Token</div>
            <div style={{ background: 'var(--gdl)', border: '1px solid rgba(200,132,26,.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--gd)', marginBottom: 14, lineHeight: 1.5 }}>
              Your 6-digit token is: <strong style={{ fontSize: 20, fontFamily: 'monospace', letterSpacing: 2 }}>{token}</strong><br />
              <span style={{ fontSize: 11, opacity: .8 }}>In production, this would be sent via SMS to your phone.</span>
            </div>
            {error && <div style={{ background: 'var(--rdl)', color: 'var(--rd)', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--mu)', marginBottom: 6 }}>6-Digit Token</label>
            <input
              value={tokenInput} onChange={e => setTokenInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              type="tel" maxLength={6} placeholder="000000"
              style={{ fontSize: 28, fontWeight: 900, textAlign: 'center', fontFamily: 'monospace', letterSpacing: 4 }}
            />
            <button onClick={validateToken} disabled={submitting || tokenInput.length !== 6} style={{
              width: '100%', padding: 15, background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)',
              border: 'none', borderRadius: 13, cursor: 'pointer',
              fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff',
              opacity: (submitting || tokenInput.length !== 6) ? .45 : 1,
            }}>{submitting ? 'Validating…' : 'Validate Token'}</button>
          </div>

        ) : step === 'form' ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>📋 Redemption Request</div>
            <div style={{ background: 'var(--gl)', border: '1px solid var(--gm)', borderRadius: 10, padding: '12px 14px', marginBottom: 14, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--mu)' }}>Gross balance</span>
                <strong>₦{plan?.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--mu)' }}>Deduction</span>
                <span style={{ color: 'var(--rd)' }}>-₦{savingsFee.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 14, borderTop: '1px solid var(--gm)', paddingTop: 8, marginTop: 4 }}>
                <span style={{ color: 'var(--g)' }}>You will receive</span>
                <span style={{ color: 'var(--g)' }}>₦{netPayout.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
            {error && <div style={{ background: 'var(--rdl)', color: 'var(--rd)', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--mu)', marginBottom: 6 }}>Reason for Redemption *</label>
            <select value={reason} onChange={e => setReason(e.target.value)}>
              <option value="">Select reason</option>
              <option>Plan matured</option>
              <option>Medical emergency</option>
              <option>School fees</option>
              <option>Business need</option>
              <option>Personal emergency</option>
              <option>Other</option>
            </select>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', marginBottom: 14 }} onClick={() => setUseBankTransfer(v => !v)}>
              <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, border: `2px solid ${useBankTransfer ? 'var(--g)' : 'var(--br)'}`, background: useBankTransfer ? 'var(--g)' : 'var(--card)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s' }}>
                {useBankTransfer && <span style={{ color: '#fff', fontSize: 14, fontWeight: 900, lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Transfer to my bank account</span>
            </div>

            {useBankTransfer && (
              <>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--mu)', marginBottom: 6 }}>Bank</label>
                <BankPicker
                  banks={banks}
                  value={bankCode}
                  onChange={(code, name) => { setBankCode(code); setBankName(name); setAccountName('') }}
                />
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--mu)', marginBottom: 6 }}>Account Number</label>
                <input
                  value={accountNumber} onChange={e => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 10)
                    setAccountNumber(v)
                    setAccountName('')
                    if (v.length === 10 && bankCode) resolveAccount(v)
                  }}
                  type="tel" maxLength={10} placeholder="10-digit account number"
                />
                {resolving && <div style={{ fontSize: 12, color: 'var(--mu)', marginTop: -8, marginBottom: 8 }}>Resolving account…</div>}
                {accountName && (
                  <div style={{ background: 'var(--gl)', border: '1px solid var(--gm)', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--g)', marginBottom: 10 }}>
                    ✅ {accountName}
                  </div>
                )}
              </>
            )}

            <button onClick={submitRequest} disabled={submitting} style={{
              width: '100%', padding: 15, background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)',
              border: 'none', borderRadius: 13, cursor: 'pointer',
              fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff',
              opacity: submitting ? .6 : 1, marginTop: 4,
            }}>{submitting ? 'Submitting…' : 'Submit Request & Get Token'}</button>
            <button onClick={() => setStep('idle')} style={{ width: '100%', padding: 13, background: 'var(--card)', border: '1.5px solid var(--br)', borderRadius: 13, cursor: 'pointer', fontSize: 14, fontWeight: 600, marginTop: 8 }}>
              Cancel
            </button>
          </div>

        ) : (
          <>
            {plan ? (
              <div style={{ background: 'linear-gradient(135deg,#071a0e,#0e4d24)', borderRadius: 16, padding: 18, textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,.45)', marginBottom: 4 }}>Available to Redeem</div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 32, fontWeight: 900, color: '#fff' }}>₦{plan.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginTop: 4 }}>
                  You receive ₦{netPayout.toLocaleString(undefined, { minimumFractionDigits: 2 })} after deduction
                </div>
                <div style={{ fontSize: 12, color: '#6edfa0', marginTop: 4 }}>A deduction will apply at withdrawal</div>
              </div>
            ) : (
              <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 16, padding: 20, textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--mu)' }}>No active savings plan to redeem.</div>
              </div>
            )}

            {redemptions.length > 0 && (
              <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>Past Requests</div>
                {redemptions.map(r => {
                  const { bg, col } = statusColor(r.status)
                  const clickable = r.status === 'Pending' || r.status === 'TokenValidated' || r.status === 'AgentApproved'
                  return (
                    <div key={r.id}
                      onClick={() => clickable ? openRedemption(r) : undefined}
                      style={{
                        padding: '12px 0', borderBottom: '1px solid var(--br)', fontSize: 13.5,
                        cursor: clickable ? 'pointer' : 'default',
                      }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--mu)' }}>{r.ref}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, background: bg, color: col }}>
                            {statusLabel(r.status)}
                          </span>
                          {clickable && <span style={{ fontSize: 14, color: 'var(--mu)' }}>›</span>}
                        </div>
                      </div>
                      <div style={{ color: 'var(--mu)', fontSize: 12, marginTop: 4 }}>
                        ₦{r.netPayout?.toLocaleString(undefined, { minimumFractionDigits: 2 })} · {new Date(r.requestedAt).toLocaleDateString('en-GB')}
                      </div>
                      {r.status === 'Pending' && (
                        <div style={{ fontSize: 11, color: 'var(--gd)', marginTop: 4, fontWeight: 600 }}>
                          Tap to enter your verification token →
                        </div>
                      )}
                      {(r.status === 'TokenValidated' || r.status === 'AgentApproved') && (
                        <div style={{ fontSize: 11, color: 'var(--b)', marginTop: 4, fontWeight: 600 }}>
                          Tap to see status →
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {plan && plan.balance > 0 && (
              <button onClick={() => setStep('form')} style={{
                width: '100%', padding: 15, background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)',
                border: 'none', borderRadius: 13, cursor: 'pointer',
                fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff',
                boxShadow: '0 6px 20px rgba(26,107,58,.35)',
              }}>💸 Request Redemption</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
