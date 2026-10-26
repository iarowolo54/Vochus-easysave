'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import BankPicker from '@/components/BankPicker'

interface Customer {
  id: string; customerId: string; firstName: string; lastName: string
  phone: string; savingsBalance: number; planDays: number | null
  planId: string | null; savingsPlans: any[]; dailyAmount: number | null; photoUrl?: string | null
}

interface MaturePlan {
  id: string; balance: number; maturityDate: string; status: string; periodDays: number; goal: string
  customer: { firstName: string; lastName: string; customerId: string }
}

interface Bank { code: string; name: string }

type Step = 'select' | 'token-issued' | 'verify' | 'direct-verify' | 'submitted'

export default function RedeemPage() {
  const { data: session } = useSession()
  const [step, setStep] = useState<Step>('select')

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [selected, setSelected] = useState<Customer | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [payoutMethod, setPayoutMethod] = useState('Cash')

  // Bank transfer fields
  const [banks, setBanks] = useState<Bank[]>([])
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null)
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [resolvingAccount, setResolvingAccount] = useState(false)
  const [accountError, setAccountError] = useState('')

  const [issuedRef, setIssuedRef] = useState('')
  const [issuedNetPayout, setIssuedNetPayout] = useState(0)
  const [tokenExpiry, setTokenExpiry] = useState('')
  const [issuedCustomerName, setIssuedCustomerName] = useState('')
  const [sentToPhone, setSentToPhone] = useState('')
  const [sentToEmail, setSentToEmail] = useState<string | null>(null)

  const [enteredToken, setEnteredToken] = useState('')
  const [verifiedRecord, setVerifiedRecord] = useState<{ id: string; ref: string; netPayout: number; payoutMethod: string; balance?: number; penalty?: number } | null>(null)

  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [maturedPlans, setMaturedPlans] = useState<MaturePlan[]>([])
  const [pendingCustomerRedemptions, setPendingCustomerRedemptions] = useState<any[]>([])
  const [approving, setApproving] = useState<string | null>(null)

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

  useEffect(() => {
    fetch('/api/cron/maturity-check', { method: 'POST' }).catch(() => {})
    fetch('/api/customers?limit=50')
      .then(r => r.json())
      .then(data => {
        const now = new Date()
        const plans: MaturePlan[] = []
        for (const c of (data.customers ?? [])) {
          for (const p of c.savingsPlans ?? []) {
            if (p.status === 'Active' && new Date(p.maturityDate) <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)) {
              plans.push({ ...p, customer: { firstName: c.firstName, lastName: c.lastName, customerId: c.customerId } })
            }
          }
        }
        setMaturedPlans(plans.slice(0, 5))
      })
  }, [toast])

  useEffect(() => {
    function loadPending() {
      fetch('/api/agent/redemption/pending')
        .then(r => r.json())
        .then(d => { if (d.records) setPendingCustomerRedemptions(d.records) })
        .catch(() => {})
    }
    loadPending()
    const iv = setInterval(loadPending, 10000)
    return () => clearInterval(iv)
  }, [])

  async function approveCustomerRedemption(id: string, action: 'approve' | 'reject') {
    setApproving(id)
    try {
      const res = await fetch(`/api/agent/redemption/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (res.ok) {
        setToast(action === 'approve' ? 'Sent to admin for final approval' : 'Redemption rejected')
        setPendingCustomerRedemptions(r => r.filter(x => x.id !== id))
      } else {
        setError(data.error ?? 'Failed')
      }
    } finally { setApproving(null) }
  }

  // Load bank list when Bank Transfer selected
  useEffect(() => {
    if (payoutMethod === 'Bank Transfer' && banks.length === 0) {
      fetch('/api/paystack/banks').then(r => r.json()).then(d => setBanks(d.banks ?? []))
    }
  }, [payoutMethod, banks.length])

  // Auto-resolve account name when 10 digits entered
  useEffect(() => {
    if (accountNumber.length === 10 && selectedBank) {
      setResolvingAccount(true)
      setAccountName('')
      setAccountError('')
      fetch('/api/paystack/resolve-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountNumber, bankCode: selectedBank.code }),
      })
        .then(r => r.json())
        .then(d => {
          setResolvingAccount(false)
          if (d.accountName) setAccountName(d.accountName)
          else setAccountError(d.error ?? 'Could not verify account')
        })
        .catch(() => { setResolvingAccount(false); setAccountError('Account verification failed') })
    } else {
      setAccountName('')
      setAccountError('')
    }
  }, [accountNumber, selectedBank])

  const eligiblePlans = selected?.savingsPlans?.filter((p: any) => p.status !== 'Redeemed' && p.balance > 0) ?? []
  const selectedPlan = eligiblePlans.find((p: any) => p.id === selectedPlanId) ?? eligiblePlans[0] ?? null

  const bankTransferReady = payoutMethod !== 'Bank Transfer' || (!!selectedBank && accountNumber.length === 10 && !!accountName)


  function resetAll() {
    setStep('select')
    setQuery(''); setResults([]); setSelected(null); setSelectedPlanId('')
    setPayoutMethod('Cash')
    setSelectedBank(null); setAccountNumber(''); setAccountName(''); setAccountError('')
    setIssuedRef(''); setIssuedNetPayout(0); setTokenExpiry(''); setIssuedCustomerName(''); setSentToPhone(''); setSentToEmail(null)
    setEnteredToken(''); setVerifiedRecord(null)
    setError('')
  }

  async function generateToken() {
    if (!selected) { setError('Select a customer first'); return }
    const planId = selectedPlan?.id
    if (!planId) { setError('No active or matured savings plan found for this customer'); return }
    if (!bankTransferReady) { setError('Verify bank account details before proceeding'); return }
    setLoading(true); setError('')
    const res = await fetch('/api/transactions/redemption/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId, customerId: selected.id, payoutMethod,
        ...(payoutMethod === 'Bank Transfer' && {
          accountNumber,
          accountName,
          bankCode: selectedBank?.code,
          bankName: selectedBank?.name,
        }),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 409) {
        setError("A redemption token was already sent to this customer's phone/email. Use 'Already have token?' to process it.")
      } else {
        setError((data as any).error ?? `Request failed (${res.status})`)
      }
      setLoading(false); return
    }
    setIssuedRef(data.ref)
    setIssuedNetPayout(data.netPayout)
    setTokenExpiry(data.tokenExpiry)
    setIssuedCustomerName(data.customerName)
    setSentToPhone(data.sentTo?.phone ?? '')
    setSentToEmail(data.sentTo?.email ?? null)
    setLoading(false)
    setStep('token-issued')
  }

  async function validateToken() {
    if (!enteredToken.trim()) { setError('Enter the token the customer provided'); return }
    setLoading(true); setError('')
    const res = await fetch('/api/transactions/redemption/verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: issuedRef, token: enteredToken.trim() }),
    })
    const data = await res.json()
    if (!data.valid) {
      setError(data.error ?? 'Token validation failed')
      setLoading(false); return
    }
    setVerifiedRecord(data.record)
    setIssuedCustomerName(data.record.customerName)
    setLoading(false)
    setStep('submitted')
  }

  async function lookupToken() {
    if (!enteredToken.trim()) { setError('Enter the redemption token'); return }
    setLoading(true); setError('')
    const res = await fetch('/api/transactions/redemption/lookup-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: enteredToken.trim() }),
    })
    const data = await res.json()
    if (!data.valid) {
      if (data.error === 'REJECTED') {
        setEnteredToken('')
        setStep('select')
        setError(`This token belongs to a rejected redemption for ${data.customerName}. Please generate a new token for this customer.`)
      } else {
        setError(data.error ?? 'Token not found')
      }
      setLoading(false); return
    }
    setVerifiedRecord(data.record)
    setIssuedCustomerName(data.record.customerName)
    setIssuedNetPayout(data.record.netPayout)
    setIssuedRef(data.record.ref)
    setLoading(false)
    setStep('submitted')
  }

  return (
    <>
      <div className="page-header">
        <h2>Redemption</h2>
        <p>Pay out a customer&apos;s matured savings</p>
      </div>

      {toast && <div className="alert alert-g" style={{ marginBottom: 16 }}>✅ {toast}</div>}
      {error && <div className="alert alert-rd" style={{ marginBottom: 16 }}>🔴 {error}</div>}

      {pendingCustomerRedemptions.length > 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            🔔 Customer Redemption Requests
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, background: 'var(--rdl)', color: 'var(--rd)' }}>{pendingCustomerRedemptions.length}</span>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--mu)', marginBottom: 14 }}>These are customer-initiated redemption requests awaiting your approval.</p>
          {pendingCustomerRedemptions.map(r => (
            <div key={r.id} style={{ border: '1px solid var(--br)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{r.customerName}</div>
                  <div style={{ fontSize: 12, color: 'var(--mu)' }}>{r.customerId} · {r.customerPhone}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, background: 'var(--gdl)', color: 'var(--gd)' }}>Awaiting Agent</span>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 13, marginBottom: 10 }}>
                <div><span style={{ color: 'var(--mu)' }}>Balance: </span><strong>₦{r.balance?.toLocaleString()}</strong></div>
                <div><span style={{ color: 'var(--mu)' }}>Net: </span><strong style={{ color: 'var(--g)' }}>₦{r.netPayout?.toLocaleString()}</strong></div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--mu)', marginBottom: 10 }}>
                {r.payoutMethod === 'BankTransfer' && r.accountName ? `Bank: ${r.bankName} · ${r.accountName} (${r.accountNumber})` : `Payout: ${r.payoutMethod}`}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-g btn-sm" disabled={approving === r.id} onClick={() => approveCustomerRedemption(r.id, 'approve')}>
                  {approving === r.id ? '…' : '✓ Approve'}
                </button>
                <button className="btn btn-out btn-sm" style={{ color: 'var(--rd)', borderColor: 'var(--rd)' }} disabled={approving === r.id} onClick={() => approveCustomerRedemption(r.id, 'reject')}>
                  ✕ Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid g-2-1">
        <div>
          {step === 'select' && (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-title">Find Customer</div>
                <div className="isearch">
                  <span className="sicon">🔍</span>
                  <input
                    className="finput" type="text" placeholder="Name, phone or ID…"
                    value={query} onChange={e => { setQuery(e.target.value); setSelected(null) }}
                  />
                </div>
                {results.length > 0 && !selected && (
                  <div style={{ border: '1px solid var(--br)', borderRadius: 8, marginTop: 8 }}>
                    {results.map(c => (
                      <div key={c.id} className="lookup-box show" style={{ cursor: 'pointer' }}
                        onClick={() => { setSelected(c); setResults([]); setQuery(`${c.firstName} ${c.lastName}`) }}>
                        {c.photoUrl ? <img src={c.photoUrl} className="av" style={{ objectFit: 'cover', borderRadius: '50%' }} alt="" /> : <div className="av av-rd">{c.firstName[0]}{c.lastName[0]}</div>}
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{c.firstName} {c.lastName}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--mu)' }}>{c.customerId} · {c.phone}</div>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--g)', marginTop: 3 }}>
                            Savings: ₦{c.savingsBalance.toLocaleString()} · {c.planDays ?? '—'} Days
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {selected && (
                  <div className="lookup-box show" style={{ marginTop: 10 }}>
                    {selected.photoUrl ? <img src={selected.photoUrl} className="av" style={{ objectFit: 'cover', borderRadius: '50%' }} alt="" /> : <div className="av av-rd">{selected.firstName[0]}{selected.lastName[0]}</div>}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{selected.firstName} {selected.lastName}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--mu)' }}>{selected.customerId} · {selected.phone}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--g)', marginTop: 3 }}>
                        Savings: ₦{selected.savingsBalance.toLocaleString()}
                        {selectedPlan?.status === 'Matured' || new Date(selectedPlan?.maturityDate) <= new Date() ? ' · Matured ✅' : ''}
                      </div>
                    </div>
                    <button className="btn btn-out btn-sm" onClick={() => { setSelected(null); setQuery('') }}>✕</button>
                  </div>
                )}
              </div>

              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-title">Redemption Details</div>
                {eligiblePlans.length > 1 && (
                  <div className="form-row">
                    <label className="flabel">Select Savings Plan</label>
                    <select className="finput" value={selectedPlanId || eligiblePlans[0]?.id} onChange={e => setSelectedPlanId(e.target.value)}>
                      {eligiblePlans.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.goal} (₦{p.balance.toLocaleString()})</option>
                      ))}
                    </select>
                  </div>
                )}
                {selected && eligiblePlans.length === 0 && (
                  <div className="alert alert-rd" style={{ marginBottom: 12 }}>No active or matured savings plan available for redemption.</div>
                )}
                {selectedPlan && (() => {
                  const isDaily = !selectedPlan.cadence || selectedPlan.cadence === 'daily'
                  const deduction = isDaily
                    ? Math.min(Math.round(selectedPlan.dailyAmount * ((selectedPlan.periodDays || 31) / 31) * 100) / 100, selectedPlan.balance)
                    : Math.min(Math.round(selectedPlan.balance * 0.20 * 100) / 100, selectedPlan.balance)
                  const netPayout = Math.round((selectedPlan.balance - deduction) * 100) / 100
                  return (
                    <div style={{ background: '#f0faf4', borderRadius: 10, padding: '12px 14px', marginBottom: 14, fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ color: 'var(--mu)' }}>Total Savings</span>
                        <strong>₦{selectedPlan.balance.toLocaleString()}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ color: 'var(--mu)' }}>Deduction</span>
                        <strong style={{ color: 'var(--rd)' }}>-₦{deduction.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #c8e6d0', paddingTop: 8, fontWeight: 700, color: 'var(--g)' }}>
                        <span>Customer Receives</span>
                        <span style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 18 }}>₦{netPayout.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  )
                })()}
                <div className="form-row">
                  <label className="flabel">Payout Method</label>
                  <select className="finput" value={payoutMethod} onChange={e => { setPayoutMethod(e.target.value); setSelectedBank(null); setAccountNumber(''); setAccountName(''); setAccountError('') }}>
                    <option>Cash</option>
                    <option>Bank Transfer</option>
                  </select>
                </div>

                {payoutMethod === 'Bank Transfer' && (
                  <div style={{ marginTop: 16, padding: '16px', background: 'var(--surface2)', borderRadius: 10, border: '1.5px solid var(--border)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      🏦 Customer Bank Account
                    </div>

                    {/* Bank selector */}
                    <div style={{ marginBottom: 12 }}>
                      <label className="flabel">Bank</label>
                      <BankPicker
                        banks={banks}
                        value={selectedBank?.code ?? ''}
                        onChange={(code, name) => { setSelectedBank({ code, name }); setAccountNumber(''); setAccountName('') }}
                      />
                    </div>

                    {/* Account number */}
                    <div style={{ marginBottom: 12 }}>
                      <label className="flabel">Account Number</label>
                      <input
                        className="finput"
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="10-digit account number"
                        value={accountNumber}
                        onChange={e => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        disabled={!selectedBank}
                      />
                    </div>

                    {/* Account name resolution */}
                    {resolvingAccount && (
                      <div style={{ fontSize: 12, color: 'var(--text3)', padding: '8px 0' }}>⏳ Verifying account…</div>
                    )}
                    {accountName && !resolvingAccount && (
                      <div style={{ background: '#f0faf4', border: '1.5px solid var(--green)', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ color: 'var(--green)', fontSize: 16 }}>✓</span>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>Account Name</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{accountName}</div>
                        </div>
                      </div>
                    )}
                    {accountError && !resolvingAccount && (
                      <div style={{ background: '#fff0f0', border: '1.5px solid var(--red)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--red)' }}>
                        ⚠️ {accountError}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="btn-row">
                <button className="btn btn-out" onClick={resetAll}>Cancel</button>
                <button className="btn btn-out" onClick={() => { setEnteredToken(''); setError(''); setStep('direct-verify') }}>
                  🔑 Already have token?
                </button>
                <button className="btn btn-b" disabled={loading || !selected || !bankTransferReady} onClick={generateToken}>
                  {loading ? '⏳ Generating…' : 'Generate Token →'}
                </button>
              </div>
            </>
          )}

          {step === 'direct-verify' && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">🔑 Verify Redemption Token</div>
              <p style={{ fontSize: 13, color: 'var(--mu)', marginBottom: 20, lineHeight: 1.6 }}>
                The customer received a 6-digit token via SMS or email when their plan matured. Ask them to read it to you and enter it below.
              </p>
              <label className="flabel">Customer&apos;s Redemption Token</label>
              <input
                className="finput"
                type="text"
                inputMode="numeric"
                placeholder="000000"
                value={enteredToken}
                onChange={e => { setEnteredToken(e.target.value.replace(/\D/g, '')); setError('') }}
                maxLength={6}
                style={{ fontFamily: 'monospace', fontSize: 36, textAlign: 'center', letterSpacing: 10, marginBottom: 20, padding: 18 }}
                autoFocus
              />
              <div className="btn-row">
                <button className="btn btn-out" onClick={() => { setStep('select'); setError(''); setEnteredToken('') }}>← Back</button>
                <button className="btn btn-b" disabled={loading || enteredToken.length < 6} onClick={lookupToken}>
                  {loading ? '⏳ Verifying…' : 'Verify & Confirm →'}
                </button>
              </div>
            </div>
          )}

          {step === 'token-issued' && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Token Sent to Customer</div>
              <div style={{ textAlign: 'center', padding: '12px 0 8px' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📨</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{issuedCustomerName}</div>
                <div style={{ fontSize: 13, color: 'var(--mu)', marginBottom: 16 }}>A 6-digit redemption token has been sent to the customer</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f0faf4', borderRadius: 9, padding: '10px 14px', fontSize: 13 }}>
                  <span>📱</span>
                  <span style={{ color: 'var(--mu)' }}>SMS sent to</span>
                  <strong style={{ marginLeft: 'auto' }}>{sentToPhone.replace(/(\d{4})(\d{3})(\d{4})/, '$1 $2 $3')}</strong>
                </div>
                {sentToEmail && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f0faf4', borderRadius: 9, padding: '10px 14px', fontSize: 13 }}>
                    <span>✉️</span>
                    <span style={{ color: 'var(--mu)' }}>Email sent to</span>
                    <strong style={{ marginLeft: 'auto' }}>{sentToEmail}</strong>
                  </div>
                )}
              </div>
              <div style={{ background: '#f5f9f6', borderRadius: 10, padding: '12px 14px', fontSize: 13, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'var(--mu)' }}>Payout Amount</span>
                  <strong style={{ color: 'var(--g)', fontSize: 15 }}>₦{issuedNetPayout.toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: 'var(--mu)' }}>Token Expires</span>
                  <span>{new Date(tokenExpiry).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--mu)' }}>Ref</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{issuedRef}</span>
                </div>
              </div>
              <div style={{ background: '#fffbea', border: '1px solid #f0d060', borderRadius: 9, padding: '10px 14px', fontSize: 12.5, color: '#7a5c00', marginBottom: 16 }}>
                ⚠️ Ask the customer to check their phone or email for the token, then read it back to you.
              </div>
              <div className="btn-row">
                <button className="btn btn-out" onClick={() => setStep('select')}>← Back</button>
                <button className="btn btn-b" onClick={() => setStep('verify')}>Customer has token →</button>
              </div>
            </div>
          )}

          {step === 'verify' && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Verify Customer Token</div>
              <p style={{ fontSize: 13, color: 'var(--mu)', marginBottom: 16 }}>
                Ask the customer to read back their token. Enter it below to validate.
              </p>
              <label className="flabel">Enter Customer Token</label>
              <input
                className="finput"
                type="text"
                placeholder="6-digit token"
                value={enteredToken}
                onChange={e => setEnteredToken(e.target.value)}
                maxLength={6}
                style={{ fontFamily: 'monospace', fontSize: 28, textAlign: 'center', letterSpacing: 6, marginBottom: 16 }}
              />
              <div className="btn-row">
                <button className="btn btn-out" onClick={() => setStep('token-issued')}>← Back</button>
                <button className="btn btn-b" disabled={loading || !enteredToken.trim()} onClick={validateToken}>
                  {loading ? '⏳ Validating…' : 'Validate Token'}
                </button>
              </div>
            </div>
          )}

          {step === 'submitted' && verifiedRecord && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ textAlign: 'center', padding: '20px 0 10px' }}>
                <div style={{ fontSize: 48, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--g)', marginBottom: 6 }}>Redemption Request Submitted!</div>
                <p style={{ fontSize: 13, color: 'var(--mu)', marginBottom: 20 }}>
                  Awaiting Super Admin approval. The customer&apos;s wallet will be cleared once approved.
                </p>
              </div>
              <div style={{ background: '#f0faf4', borderRadius: 10, padding: '14px 16px', fontSize: 13, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--mu)' }}>Customer</span>
                  <strong>{issuedCustomerName}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--mu)' }}>Amount</span>
                  <strong style={{ color: 'var(--g)', fontSize: 15 }}>₦{verifiedRecord.netPayout.toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--mu)' }}>Payout Method</span>
                  <span>{verifiedRecord.payoutMethod}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--mu)' }}>Ref</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{verifiedRecord.ref}</span>
                </div>
              </div>
              <div className="btn-row" style={{ justifyContent: 'center' }}>
                <button className="btn btn-b" onClick={resetAll}>Process Another Redemption</button>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="sec-label" style={{ marginTop: 0 }}>Maturing Soon</div>
          <div className="card">
            {maturedPlans.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--mu)', fontSize: 13, padding: 12 }}>No plans maturing soon</div>
            )}
            {maturedPlans.map((p, i) => {
              const matured = new Date(p.maturityDate) <= new Date()
              const days = Math.ceil((new Date(p.maturityDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              return (
                <div key={p.id} className="cust-row" style={{ padding: '9px 0', borderBottom: i < maturedPlans.length - 1 ? undefined : 'none' }}>
                  <div className="av av-rd">{p.customer.firstName[0]}{p.customer.lastName[0]}</div>
                  <div>
                    <div className="cust-name">{p.customer.firstName} {p.customer.lastName}</div>
                    <div className="cust-sub">
                      {matured ? 'Matured' : `Matures ${new Date(p.maturityDate).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}`} · {p.periodDays} Days
                    </div>
                  </div>
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, color: matured ? 'var(--g)' : 'var(--mu)' }}>
                      ₦{p.balance.toLocaleString()}
                    </div>
                    <span className={`bdg ${matured ? 'bdg-g' : 'bdg-gd'}`} style={{ fontSize: 10 }}>
                      {matured ? 'Ready' : `${days} days`}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
