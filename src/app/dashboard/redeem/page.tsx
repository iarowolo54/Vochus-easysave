'use client'

import { useState, useEffect, useCallback } from 'react'
import BankSelect from '@/components/ui/BankSelect'
import CodeBoxes from '@/components/ui/CodeBoxes'
import EmptyState from '@/components/ui/EmptyState'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import Toast from '@/components/ui/Toast'
import { Icons } from '@/components/ui/icons'
import { avatarTint } from '@/lib/avatar'
import { displayName, formatDate, formatNaira } from '@/lib/format'

interface Plan {
  id: string; goal: string; status: string; balance: number; dailyAmount: number
  periodDays: number; cadence?: string; maturityDate: string
}

interface Customer {
  id: string; customerId: string; firstName: string; lastName: string
  phone: string; savingsBalance: number; planDays: number | null
  planId: string | null; savingsPlans: Plan[]; dailyAmount: number | null; photoUrl?: string | null
}

interface MaturePlan extends Plan {
  customer: Customer
}

interface PendingRequest {
  id: string; customerName: string; customerId: string; customerPhone: string
  balance?: number; netPayout?: number; payoutMethod: string
  bankName?: string; accountName?: string; accountNumber?: string
}

interface Bank { code: string; name: string }

type Step = 'select' | 'token-issued' | 'verify' | 'direct-verify' | 'submitted'

/** Same fee rule the payout preview has always used: a day's saving per 31 days on daily plans, 20% otherwise. */
function payoutFor(p: Plan) {
  const isDaily = !p.cadence || p.cadence === 'daily'
  const deduction = isDaily
    ? Math.min(Math.round(p.dailyAmount * ((p.periodDays || 31) / 31) * 100) / 100, p.balance)
    : Math.min(Math.round(p.balance * 0.20 * 100) / 100, p.balance)
  return { deduction, net: Math.round((p.balance - deduction) * 100) / 100 }
}

const fullName = (c: Pick<Customer, 'firstName' | 'lastName'>) => displayName(`${c.firstName} ${c.lastName}`)

function Avatar({ c }: { c: Customer }) {
  return c.photoUrl
    ? <img src={c.photoUrl} className="ui-avatar" alt="" />
    : <span className={`ui-avatar ag-av ag-av--${avatarTint(c.customerId)}`} aria-hidden="true">{c.firstName[0]}{c.lastName[0]}</span>
}

export default function RedeemPage() {
  const [step, setStep] = useState<Step>('select')

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Customer | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [payoutMethod, setPayoutMethod] = useState('Cash')

  // Bank transfer fields
  const [banks, setBanks] = useState<Bank[]>([])
  const [banksLoading, setBanksLoading] = useState(false)
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
  const [refreshKey, setRefreshKey] = useState(0)
  const [maturedPlans, setMaturedPlans] = useState<MaturePlan[] | null>(null)
  const [pendingCustomerRedemptions, setPendingCustomerRedemptions] = useState<PendingRequest[]>([])
  const [approving, setApproving] = useState<string | null>(null)

  const search = useCallback(async () => {
    if (!query.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(query)}&limit=5`)
      const data = await res.json()
      setResults(data.customers ?? [])
    } catch {
      setResults([])
    }
    setSearching(false)
  }, [query])

  useEffect(() => {
    if (selected) return
    const t = setTimeout(search, 300)
    return () => clearTimeout(t)
  }, [search, selected])

  useEffect(() => {
    fetch('/api/cron/maturity-check', { method: 'POST' }).catch(() => {})
    fetch('/api/customers?limit=50')
      .then(r => r.json())
      .then(data => {
        const now = new Date()
        const plans: MaturePlan[] = []
        for (const c of (data.customers ?? []) as Customer[]) {
          for (const p of c.savingsPlans ?? []) {
            if (p.status === 'Active' && p.balance > 0 && new Date(p.maturityDate) <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)) {
              plans.push({ ...p, customer: c })
            }
          }
        }
        plans.sort((a, b) => new Date(a.maturityDate).getTime() - new Date(b.maturityDate).getTime())
        setMaturedPlans(plans.slice(0, 5))
      })
      .catch(() => setMaturedPlans(prev => prev ?? []))
  }, [refreshKey])

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
        setToast(action === 'approve' ? 'Approved. It’s now with the admin for final approval.' : 'Request declined')
        setPendingCustomerRedemptions(r => r.filter(x => x.id !== id))
        setRefreshKey(k => k + 1)
      } else {
        setError(data.error ?? 'That didn’t go through. Please try again.')
      }
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally { setApproving(null) }
  }

  // Load bank list when Bank Transfer selected
  useEffect(() => {
    if (payoutMethod === 'Bank Transfer' && banks.length === 0) {
      setBanksLoading(true)
      fetch('/api/paystack/banks').then(r => r.json()).then(d => setBanks(d.banks ?? [])).catch(() => {}).finally(() => setBanksLoading(false))
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
          else setAccountError(d.error ?? 'We couldn’t confirm this account. Check the number and bank.')
        })
        .catch(() => { setResolvingAccount(false); setAccountError('We couldn’t confirm this account. Check your connection.') })
    } else {
      setAccountName('')
      setAccountError('')
    }
  }, [accountNumber, selectedBank])

  const eligiblePlans = selected?.savingsPlans?.filter(p => p.status !== 'Redeemed' && p.balance > 0) ?? []
  const selectedPlan = eligiblePlans.find(p => p.id === selectedPlanId) ?? eligiblePlans[0] ?? null
  const preview = selectedPlan ? payoutFor(selectedPlan) : null
  const planMatured = selectedPlan ? (selectedPlan.status === 'Matured' || new Date(selectedPlan.maturityDate) <= new Date()) : false

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

  function choose(c: Customer, planId = '') {
    setSelected(c); setResults([]); setQuery(`${c.firstName} ${c.lastName}`); setSelectedPlanId(planId); setError('')
    setStep('select')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function generateToken() {
    if (!selected) { setError('Choose a customer first.'); return }
    const planId = selectedPlan?.id
    if (!planId) { setError('This customer has no savings plan that can be collected.'); return }
    if (!bankTransferReady) { setError('Confirm the bank account before continuing.'); return }
    setLoading(true); setError('')
    let res: Response
    let data: { error?: string; ref?: string; netPayout?: number; tokenExpiry?: string; customerName?: string; sentTo?: { phone?: string; email?: string } }
    try {
      res = await fetch('/api/transactions/redemption/request', {
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
      data = await res.json().catch(() => ({}))
    } catch {
      setError('No connection. Check your internet and try again.'); setLoading(false); return
    }
    if (!res.ok) {
      if (res.status === 409) {
        setError('A collection code was already sent to this customer. Use “Customer already has a code” to finish it.')
      } else {
        setError(data.error ?? `The request didn’t go through (${res.status}). Please try again.`)
      }
      setLoading(false); return
    }
    setIssuedRef(data.ref ?? '')
    setIssuedNetPayout(data.netPayout ?? 0)
    setTokenExpiry(data.tokenExpiry ?? '')
    setIssuedCustomerName(data.customerName ?? '')
    setSentToPhone(data.sentTo?.phone ?? '')
    setSentToEmail(data.sentTo?.email ?? null)
    setLoading(false)
    setStep('token-issued')
  }

  async function validateToken() {
    if (!enteredToken.trim()) { setError('Enter the code the customer received.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/transactions/redemption/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: issuedRef, token: enteredToken.trim() }),
      })
      const data = await res.json()
      if (!data.valid) {
        setError(data.error ?? 'That code didn’t work. Check it with the customer.')
        setLoading(false); return
      }
      setVerifiedRecord(data.record)
      setIssuedCustomerName(data.record.customerName)
      setLoading(false)
      setStep('submitted')
      setRefreshKey(k => k + 1)
    } catch {
      setError('No connection. Check your internet and try again.'); setLoading(false)
    }
  }

  async function lookupToken() {
    if (!enteredToken.trim()) { setError('Enter the collection code.'); return }
    setLoading(true); setError('')
    try {
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
          setError(`This code belongs to a declined collection for ${data.customerName}. Send them a new code.`)
        } else {
          setError(data.error ?? 'We couldn’t find that code.')
        }
        setLoading(false); return
      }
      setVerifiedRecord(data.record)
      setIssuedCustomerName(data.record.customerName)
      setIssuedNetPayout(data.record.netPayout)
      setIssuedRef(data.record.ref)
      setLoading(false)
      setStep('submitted')
      setRefreshKey(k => k + 1)
    } catch {
      setError('No connection. Check your internet and try again.'); setLoading(false)
    }
  }

  const stepNo = step === 'select' ? 1 : step === 'submitted' ? 3 : 2
  const formattedPhone = sentToPhone.replace(/(\d{4})(\d{3})(\d{4})/, '$1 $2 $3')

  return (
    <div className="ag-page">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}

      <div className="ag-collect">
        <div className="ag-collect-main">
          {pendingCustomerRedemptions.length > 0 && step === 'select' && !selected && (
            <section className="ag-requests" aria-labelledby="req-title">
              <div className="ag-requests-head">
                <h2 id="req-title">Customers asking to collect</h2>
                <span className="ag-badge-count">{pendingCustomerRedemptions.length}</span>
              </div>
              {pendingCustomerRedemptions.map(r => (
                <article key={r.id} className="ag-request">
                  <div className="ag-request-top">
                    <div className="ag-payee-main">
                      <p className="ui-row-title">{displayName(r.customerName)}</p>
                      <p className="ui-row-sub">{r.customerId} · {r.customerPhone}</p>
                    </div>
                    <div className="ag-request-amount">
                      <span className="ui-row-sub ui-block">Receives</span>
                      <strong>{formatNaira(r.netPayout ?? 0)}</strong>
                    </div>
                  </div>
                  <p className="ag-request-meta">
                    Saved {formatNaira(r.balance ?? 0)} · {r.payoutMethod === 'BankTransfer' && r.accountName ? `${r.bankName}, ${r.accountName} (•••• ${String(r.accountNumber ?? '').slice(-4)})` : r.payoutMethod}
                  </p>
                  <div className="ag-request-actions">
                    <button type="button" className="ui-btn ui-btn--secondary ag-btn-danger" disabled={approving === r.id} onClick={() => approveCustomerRedemption(r.id, 'reject')}>Decline</button>
                    <button type="button" className="ui-btn ui-btn--primary" disabled={approving === r.id} onClick={() => approveCustomerRedemption(r.id, 'approve')}>
                      {approving === r.id ? <span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> : <Icons.check size={18} aria-hidden="true" />} Approve
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}

          <div className="ag-panel">
            <header className="ag-flow-head ag-panel-head">
              <div className="ag-flow-nav">
                {step === 'token-issued' || step === 'direct-verify' || (step === 'select' && selected)
                  ? <button type="button" className="ui-icon-btn ui-icon-btn--soft" aria-label="Back"
                      onClick={() => { setError(''); if (step === 'select') { setSelected(null); setQuery('') } else { setStep('select'); setEnteredToken('') } }}>
                      <Icons.back size={20} aria-hidden="true" />
                    </button>
                  : step === 'verify'
                    ? <button type="button" className="ui-icon-btn ui-icon-btn--soft" aria-label="Back" onClick={() => { setError(''); setStep('token-issued') }}><Icons.back size={20} aria-hidden="true" /></button>
                    : <span className="ag-flow-nav-gap" />}
                <span className="ag-flow-count">Pay out savings · {stepNo === 1 ? 'Details' : stepNo === 2 ? 'Customer’s code' : 'Done'}</span>
                <span className="ag-flow-nav-gap" />
              </div>
              <div className="ag-flow-line" aria-hidden="true"><span style={{ width: `${(stepNo / 3) * 100}%` }} /></div>
            </header>

            <div className="ag-flow-body">
              {/* Choose the customer */}
              {step === 'select' && !selected && (
                <>
                  <h2 className="ag-q">Who’s collecting their savings?</h2>
                  <p className="ag-q-lead">Find the customer, check what they’ll receive, then we send them a code to confirm.</p>
                  <FormError message={error} />
                  <div className="ag-search">
                    <Icons.search size={20} aria-hidden="true" />
                    <input className="ui-input" type="search" enterKeyHint="search" autoComplete="off" placeholder="Name, phone or customer ID"
                      aria-label="Search customers" value={query} onChange={e => setQuery(e.target.value)} />
                    {searching && <span className="ui-spinner ag-search-spin" aria-label="Searching" />}
                  </div>
                  {results.length > 0 && (
                    <div className="ag-pick-list">
                      {results.map(c => (
                        <button key={c.id} type="button" className="ag-pick" onClick={() => choose(c)}>
                          <Avatar c={c} />
                          <span className="ag-payee-main">
                            <span className="ui-row-title ui-block">{fullName(c)}</span>
                            <span className="ui-row-sub ui-block">{c.customerId} · {c.phone}</span>
                          </span>
                          <span className="ag-pick-amount">{formatNaira(c.savingsBalance, { minor: false })}</span>
                          <Icons.next size={18} aria-hidden="true" className="ui-row-chevron" />
                        </button>
                      ))}
                    </div>
                  )}
                  {!searching && query.trim() && results.length === 0 && <p className="ui-note">No customer matches “{query.trim()}”.</p>}

                  <button type="button" className="ag-alt-link" onClick={() => { setEnteredToken(''); setError(''); setStep('direct-verify') }}>
                    <span className="ag-alt-icon" aria-hidden="true"><Icons.locked size={20} /></span>
                    <span className="ag-payee-main">
                      <span className="ui-row-title ui-block">Customer already has a code?</span>
                      <span className="ui-row-sub ui-block">Enter it to finish their collection</span>
                    </span>
                    <Icons.next size={18} aria-hidden="true" />
                  </button>
                </>
              )}

              {/* Payout details */}
              {step === 'select' && selected && (
                <>
                  <div className="ag-who">
                    <Avatar c={selected} />
                    <div className="ag-payee-main">
                      <p className="ui-row-title">{fullName(selected)}</p>
                      <p className="ui-row-sub">{selected.customerId} · {selected.phone}</p>
                    </div>
                    <button type="button" className="ui-link" onClick={() => { setSelected(null); setQuery(''); setError('') }}>Change</button>
                  </div>

                  {eligiblePlans.length === 0 ? (
                    <EmptyState icon="plan" title="Nothing to collect" text="This customer has no savings plan with money in it." />
                  ) : (
                    <>
                      <h2 className="ag-q ag-q--amount">
                        <span className="ag-q-kicker">They’ll receive</span>
                        {formatNaira(preview?.net ?? 0)}
                      </h2>
                      {selectedPlan && !planMatured && (
                        <p className="ag-early"><Icons.pending size={16} aria-hidden="true" /> This plan ends {formatDate(selectedPlan.maturityDate)}, so this is an early collection.</p>
                      )}

                      <FormError message={error} />

                      {eligiblePlans.length > 1 && (
                        <>
                          <p className="ag-label">Which plan?</p>
                          <div className="ag-radio-group ag-plan-pick">
                            {eligiblePlans.map(p => (
                              <button key={p.id} type="button" role="radio" aria-checked={selectedPlan?.id === p.id} className="ag-radio" onClick={() => setSelectedPlanId(p.id)}>
                                <span className="ag-payee-main">
                                  <span className="ui-row-title ui-block">{p.goal}</span>
                                  <span className="ui-row-sub ui-block">{formatNaira(p.balance)} saved · ends {formatDate(p.maturityDate)}</span>
                                </span>
                                <span className="ui-radio" aria-hidden="true" />
                              </button>
                            ))}
                          </div>
                        </>
                      )}

                      {preview && selectedPlan && (
                        <dl className="ag-breakdown">
                          <div><dt>{eligiblePlans.length > 1 ? selectedPlan.goal : 'Total saved'}</dt><dd>{formatNaira(selectedPlan.balance)}</dd></div>
                          <div><dt>Platform fee</dt><dd className="ag-neg">−{formatNaira(preview.deduction)}</dd></div>
                          <div className="ag-breakdown-total"><dt>Customer receives</dt><dd>{formatNaira(preview.net)}</dd></div>
                        </dl>
                      )}

                      <p className="ag-label">How are you paying them?</p>
                      <div className="ag-radio-group">
                        {[
                          { v: 'Cash', t: 'Cash', s: 'Hand it to the customer', icon: 'cash' as const },
                          { v: 'Bank Transfer', t: 'Bank transfer', s: 'Sent to their bank account', icon: 'loan' as const },
                        ].map(o => {
                          const Icon = Icons[o.icon]
                          return (
                            <button key={o.v} type="button" role="radio" aria-checked={payoutMethod === o.v} className="ag-radio"
                              onClick={() => { setPayoutMethod(o.v); setSelectedBank(null); setAccountNumber(''); setAccountName(''); setAccountError('') }}>
                              <span className="ag-radio-icon" aria-hidden="true"><Icon size={20} /></span>
                              <span className="ag-payee-main">
                                <span className="ui-row-title ui-block">{o.t}</span>
                                <span className="ui-row-sub ui-block">{o.s}</span>
                              </span>
                              <span className="ui-radio" aria-hidden="true" />
                            </button>
                          )
                        })}
                      </div>

                      {payoutMethod === 'Bank Transfer' && (
                        <div className="ag-bank-fields">
                          <BankSelect banks={banks} loading={banksLoading} value={selectedBank}
                            onChange={b => { setSelectedBank(b); setAccountNumber(''); setAccountName('') }} />
                          <div className="ag-tf-wrap">
                            <div className={`ag-tf${accountError ? ' is-invalid' : ''}${!selectedBank ? ' is-disabled' : ''}`}>
                              <label className="ag-tf-label" htmlFor="acct">Account number</label>
                              <input id="acct" className="ag-tf-input ag-tf-num" inputMode="numeric" maxLength={10} placeholder="10 digits" disabled={!selectedBank}
                                value={accountNumber} aria-invalid={!!accountError || undefined} aria-describedby={accountError ? 'acct-error' : undefined}
                                onChange={e => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))} />
                            </div>
                            {resolvingAccount && <p className="ag-fineprint"><span className="ui-spinner ui-spinner--sm ag-spin-dark ag-inline-spin" aria-hidden="true" /> Checking the account…</p>}
                            <FieldError id="acct-error" message={!resolvingAccount ? accountError : ''} />
                          </div>
                          {accountName && !resolvingAccount && (
                            <div className="ag-verified ag-verified--sm">
                              <span className="ag-verified-icon" aria-hidden="true"><Icons.check size={18} /></span>
                              <div>
                                <p className="ui-row-sub">Account name</p>
                                <p className="ui-row-title">{accountName}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="ag-flow-actions">
                        <button type="button" className="ui-btn ui-btn--primary ag-flow-cta" disabled={loading || !bankTransferReady} onClick={generateToken}>
                          {loading ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending code…</> : 'Send code to customer'}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Code sent */}
              {step === 'token-issued' && (
                <>
                  <span className="ag-big-icon" aria-hidden="true"><Icons.send size={26} /></span>
                  <h2 className="ag-q">We sent {displayName(issuedCustomerName)} a code</h2>
                  <p className="ag-q-lead">Ask them to check their messages and read the 6-digit code back to you.</p>
                  <dl className="ag-breakdown">
                    {sentToPhone && <div><dt>Text message</dt><dd>{formattedPhone}</dd></div>}
                    {sentToEmail && <div><dt>Email</dt><dd>{sentToEmail}</dd></div>}
                    <div><dt>Code expires</dt><dd>{tokenExpiry ? new Date(tokenExpiry).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '—'}</dd></div>
                    <div><dt>Reference</dt><dd className="ag-mono">{issuedRef}</dd></div>
                    <div className="ag-breakdown-total"><dt>They’ll receive</dt><dd>{formatNaira(issuedNetPayout)}</dd></div>
                  </dl>
                  <div className="ag-flow-actions">
                    <button type="button" className="ui-btn ui-btn--primary ag-flow-cta" onClick={() => { setEnteredToken(''); setError(''); setStep('verify') }}>They have the code</button>
                  </div>
                </>
              )}

              {/* Enter code (after sending, or one they already have) */}
              {(step === 'verify' || step === 'direct-verify') && (
                <>
                  <h2 className="ag-q">{step === 'verify' ? 'Enter the code they received' : 'Enter the customer’s code'}</h2>
                  <p className="ag-q-lead">
                    {step === 'verify'
                      ? <>Ask {displayName(issuedCustomerName) || 'the customer'} to read it out. It confirms they agree to this payout.</>
                      : 'The customer got a 6-digit collection code by text or email. Ask them to read it to you.'}
                  </p>
                  <FormError message={error} />
                  <CodeBoxes value={enteredToken} onChange={v => { setEnteredToken(v); setError('') }} label="Collection code" autoFocus
                    onComplete={step === 'verify' ? validateToken : lookupToken} error={!!error} />
                  <div className="ag-flow-actions">
                    <button type="button" className="ui-btn ui-btn--primary ag-flow-cta"
                      disabled={loading || (step === 'verify' ? !enteredToken.trim() : enteredToken.length < 6)}
                      onClick={step === 'verify' ? validateToken : lookupToken}>
                      {loading ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Checking…</> : 'Confirm code'}
                    </button>
                  </div>
                </>
              )}

              {/* Done */}
              {step === 'submitted' && verifiedRecord && (
                <div className="ag-sent">
                  <span className="ag-sent-icon" aria-hidden="true"><Icons.check size={30} /></span>
                  <h2 className="ag-q">Sent for approval</h2>
                  <p className="ag-q-lead">The admin approves every payout. The customer’s savings are cleared once it’s approved.</p>
                  <dl className="ag-breakdown">
                    <div><dt>Customer</dt><dd>{displayName(issuedCustomerName)}</dd></div>
                    <div><dt>Paid by</dt><dd>{verifiedRecord.payoutMethod}</dd></div>
                    <div><dt>Reference</dt><dd className="ag-mono">{verifiedRecord.ref}</dd></div>
                    <div className="ag-breakdown-total"><dt>Amount</dt><dd>{formatNaira(verifiedRecord.netPayout)}</dd></div>
                  </dl>
                  <div className="ag-flow-actions">
                    <button type="button" className="ui-btn ui-btn--primary ag-flow-cta" onClick={resetAll}>Pay out another customer</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="ag-collect-side" aria-labelledby="mat-title">
          <div className="ui-section-head"><h2 id="mat-title">Ending this week</h2></div>
          {maturedPlans === null ? (
            <section className="ui-card"><p className="ui-note ui-note--center">Loading…</p></section>
          ) : maturedPlans.length === 0 ? (
            <section className="ui-card"><EmptyState icon="calendar" title="Nothing ending this week" text="Plans that end in the next 7 days show here." /></section>
          ) : (
            <section className="ui-card ui-card--list">
              {maturedPlans.map(p => {
                const ready = new Date(p.maturityDate) <= new Date()
                const days = Math.ceil((new Date(p.maturityDate).getTime() - Date.now()) / 86400000)
                return (
                  <button key={p.id} type="button" className="ui-row ui-row--button ag-mat-row" onClick={() => choose(p.customer, p.id)}>
                    <Avatar c={p.customer} />
                    <span className="ui-row-main">
                      <span className="ui-row-title ui-block">{fullName(p.customer)}</span>
                      <span className="ui-row-sub ui-block">{p.goal} · {formatNaira(p.balance, { minor: false })}</span>
                    </span>
                    <span className={`ui-status ui-status--sm ${ready ? 'ui-status--success' : 'ui-status--warn'}`}>
                      {ready ? 'Ready' : days === 1 ? 'Tomorrow' : `${days} days`}
                    </span>
                  </button>
                )
              })}
            </section>
          )}
          <p className="ag-fineprint ag-side-note">Tap a customer to start their payout.</p>
        </aside>
      </div>
    </div>
  )
}
