'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import AmountField from '@/components/ui/AmountField'
import EmptyState from '@/components/ui/EmptyState'
import { FormError } from '@/components/ui/FormErrors'
import { Icons } from '@/components/ui/icons'
import { avatarTint } from '@/lib/avatar'
import { displayName, formatDate, formatNaira } from '@/lib/format'

interface Customer {
  id: string; customerId: string; firstName: string; lastName: string
  phone: string; savingsBalance: number; activeLoan: { ref: string; totalAmount: number; status: string } | null; photoUrl?: string | null
}

interface Rate { id: string; durationDays: number; label: string; rate: number; maxAmount?: number | null; enabled?: boolean }
interface Loan { ref: string; principal: number; status: string; customer: { name: string } }

const LIMIT = 0.8 // a customer can borrow up to 80% of what they've saved

function Avatar({ c }: { c: Customer }) {
  return c.photoUrl
    ? <img src={c.photoUrl} className="ui-avatar" alt="" />
    : <span className={`ui-avatar ag-av ag-av--${avatarTint(c.customerId)}`} aria-hidden="true">{c.firstName[0]}{c.lastName[0]}</span>
}

function loanStatus(s: string): { label: string; tone: 'warn' | 'success' | 'danger' | 'neutral' } {
  if (s === 'Pending') return { label: 'Waiting for approval', tone: 'warn' }
  if (s === 'Approved') return { label: 'Approved · ready to pay out', tone: 'success' }
  if (s === 'Rejected') return { label: 'Declined', tone: 'danger' }
  return { label: s, tone: 'neutral' }
}

export default function LoanRequestPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Customer | null>(null)
  const [rates, setRates] = useState<Rate[]>([])
  const [ratesLoaded, setRatesLoaded] = useState(false)
  const [ratesError, setRatesError] = useState(false)
  const [selectedRate, setSelectedRate] = useState<Rate | null>(null)
  const [principal, setPrincipal] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<{ ref: string; name: string; amount: number } | null>(null)
  const [recentLoans, setRecentLoans] = useState<Loan[] | null>(null)

  const loadRates = useCallback(() => {
    setRatesError(false)
    fetch('/api/interest-rates')
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((d: { rates?: Rate[] }) => {
        // Lengths the admin has switched off are refused by the server, so don't offer them.
        const offered = (d.rates ?? []).filter(r => r.enabled !== false)
        setRates(offered)
        setSelectedRate(offered[0] ?? null)
        setRatesLoaded(true)
      })
      // A failure must not look like "no lengths offered" (which blames the admin) or hang on
      // "Loading…" forever — surface a retry instead.
      .catch(() => { setRatesError(true); setRatesLoaded(true) })
  }, [])

  useEffect(() => {
    loadRates()
    fetch('/api/loans?status=Pending,Approved').then(r => r.json())
      .then(d => setRecentLoans((d.loans ?? []).slice(0, 4)))
      .catch(() => setRecentLoans([]))
  }, [created, loadRates])

  const search = useCallback(async () => {
    if (!query.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(query)}&limit=5`)
      const data = await res.json()
      setResults(data.customers ?? [])
    } catch { setResults([]) }
    setSearching(false)
  }, [query])

  useEffect(() => {
    if (selected) return
    const t = setTimeout(search, 300)
    return () => clearTimeout(t)
  }, [search, selected])

  const maxLoan = selected ? selected.savingsBalance * LIMIT : 0
  // The admin can cap each loan length; the lower of that and 80% of savings is the real limit.
  const cap = selectedRate?.maxAmount ?? null
  const capBinds = cap !== null && cap < maxLoan
  const limit = capBinds ? cap : maxLoan
  const limitText = capBinds && selectedRate
    ? `the largest ${selectedRate.durationDays}-day loan, ${formatNaira(limit, { minor: false })}`
    : `their limit of ${formatNaira(limit, { minor: false })}`
  const amt = parseFloat(principal || '0')
  const interest = selectedRate && amt ? (amt * selectedRate.rate) / 100 : 0
  const total = amt + interest
  const tooMuch = !!selected && amt > limit
  const due = selectedRate ? new Date(Date.now() + selectedRate.durationDays * 86400000) : null

  async function submit() {
    if (!selected) { setError('Choose a customer first.'); return }
    if (!principal || amt <= 0) { setError('Enter how much they want to borrow.'); return }
    if (!selectedRate) { setError('Choose how long the loan is for.'); return }
    if (amt > limit) {
      setError(capBinds && selectedRate
        ? `The largest loan for ${selectedRate.durationDays} days is ${formatNaira(limit)}.`
        : `The most they can borrow is ${formatNaira(limit)} (80% of their savings).`)
      return
    }
    if (selected.activeLoan) { setError('This customer already has a loan. They need to repay it first.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selected.id,
          principal: amt,
          durationDays: selectedRate.durationDays,
          interestRate: selectedRate.rate,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'The request didn’t go through. Please try again.'); setLoading(false); return }
      setCreated({ ref: data.loan.ref, name: displayName(`${selected.firstName} ${selected.lastName}`), amount: amt })
    } catch {
      setError('No connection. Check your loan list before trying again, so it isn’t requested twice.')
    }
    setLoading(false)
  }

  function reset() {
    setCreated(null); setSelected(null); setQuery(''); setResults([]); setPrincipal(''); setError('')
    if (rates.length) setSelectedRate(rates[0])
  }

  return (
    <div className="ag-page">
      <div className="ag-collect">
        <div className="ag-collect-main">
          <div className="ag-panel">
            <div className="ag-flow-body">
              {created ? (
                <div className="ag-sent">
                  <span className="ag-sent-icon" aria-hidden="true"><Icons.check size={30} /></span>
                  <h2 className="ag-q">Sent for approval</h2>
                  <p className="ag-q-lead">An admin checks every loan. Once it’s approved you can pay it out from Disburse loan.</p>
                  <dl className="ag-breakdown">
                    <div><dt>Customer</dt><dd>{created.name}</dd></div>
                    <div><dt>Reference</dt><dd className="ag-mono">{created.ref}</dd></div>
                    <div className="ag-breakdown-total"><dt>Loan</dt><dd>{formatNaira(created.amount)}</dd></div>
                  </dl>
                  <div className="ag-stack-actions">
                    <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={reset}>Request another loan</button>
                    <Link href="/dashboard/loan-disburse" className="ui-btn ui-btn--secondary ui-btn--block">Go to Disburse loan</Link>
                  </div>
                </div>
              ) : !selected ? (
                <>
                  <h2 className="ag-q">Who needs a loan?</h2>
                  <p className="ag-q-lead">Customers can borrow up to 80% of what they’ve saved, one loan at a time.</p>
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
                        <button key={c.id} type="button" className="ag-pick" onClick={() => { setSelected(c); setResults([]); setError('') }}>
                          <Avatar c={c} />
                          <span className="ag-payee-main">
                            <span className="ui-row-title ui-block">{displayName(`${c.firstName} ${c.lastName}`)}</span>
                            <span className="ui-row-sub ui-block">{c.activeLoan ? 'Has a loan already' : `Can borrow up to ${formatNaira(c.savingsBalance * LIMIT, { minor: false })}`}</span>
                          </span>
                          {c.activeLoan
                            ? <span className="ui-status ui-status--sm ui-status--warn">Has a loan</span>
                            : <span className="ag-pick-amount">{formatNaira(c.savingsBalance, { minor: false })}</span>}
                          <Icons.next size={18} aria-hidden="true" className="ui-row-chevron" />
                        </button>
                      ))}
                    </div>
                  )}
                  {!searching && query.trim() && results.length === 0 && <p className="ui-note">No customer matches “{query.trim()}”.</p>}
                </>
              ) : (
                <>
                  <div className="ag-who">
                    <Avatar c={selected} />
                    <div className="ag-payee-main">
                      <p className="ui-row-title">{displayName(`${selected.firstName} ${selected.lastName}`)}</p>
                      <p className="ui-row-sub">Saved {formatNaira(selected.savingsBalance, { minor: false })} · can borrow up to {formatNaira(maxLoan, { minor: false })}</p>
                    </div>
                    <button type="button" className="ui-link" onClick={() => { setSelected(null); setQuery(''); setPrincipal(''); setError('') }}>Change</button>
                  </div>

                  {selected.activeLoan ? (
                    <EmptyState icon="loan" title="They already have a loan" text={`${displayName(selected.firstName)} needs to finish repaying ${selected.activeLoan.ref} before taking another.`}
                      action={<Link href={`/dashboard/loan-repay?cid=${encodeURIComponent(selected.customerId)}`} className="ui-btn ui-btn--secondary">Record a repayment</Link>} />
                  ) : maxLoan <= 0 ? (
                    <EmptyState icon="plan" title="Nothing saved yet" text="Customers can borrow once they have savings. The limit is 80% of what they’ve saved." />
                  ) : (
                    <>
                      <p className="ag-label ag-label--first">How much?</p>
                      <AmountField value={principal} onChange={v => { setPrincipal(v); setError('') }} invalid={tooMuch}
                        hint={tooMuch ? `That’s more than ${limitText}` : `Up to ${formatNaira(limit, { minor: false })}${capBinds ? ` for ${selectedRate?.durationDays} days` : ''}`} />
                      <div className="ag-quick">
                        {[0.25, 0.5, 1].map(f => {
                          const v = Math.floor(limit * f)
                          return v > 0 ? <button key={f} type="button" className="ag-chip" aria-pressed={amt === v} onClick={() => setPrincipal(String(v))}>{f === 1 ? `Max ${formatNaira(v, { minor: false })}` : formatNaira(v, { minor: false })}</button> : null
                        })}
                      </div>

                      <p className="ag-label">For how long?</p>
                      {!ratesLoaded ? <p className="ui-note">Loading the loan lengths…</p> : ratesError ? <p className="ui-note">Couldn’t load the loan lengths. <button type="button" className="ui-link" onClick={loadRates}>Try again</button></p> : rates.length === 0 ? <p className="ui-note">No loan lengths are offered right now. Ask Vochus admin.</p> : (
                        <div className="ag-radio-group">
                          {rates.map(r => (
                            <button key={r.id} type="button" role="radio" aria-checked={selectedRate?.id === r.id} className="ag-radio" onClick={() => setSelectedRate(r)}>
                              <span className="ag-payee-main">
                                <span className="ui-row-title ui-block">{r.label}</span>
                                <span className="ui-row-sub ui-block">{r.rate}% interest{r.maxAmount != null ? ` · up to ${formatNaira(r.maxAmount, { minor: false })}` : ''}{amt > 0 ? ` · repay ${formatNaira(amt + amt * r.rate / 100, { minor: false })}` : ''}</span>
                              </span>
                              <span className="ui-radio" aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      )}

                      {amt > 0 && selectedRate && !tooMuch && (
                        <dl className="ag-breakdown">
                          <div><dt>Loan</dt><dd>{formatNaira(amt)}</dd></div>
                          <div><dt>Interest ({selectedRate.rate}%)</dt><dd>{formatNaira(interest)}</dd></div>
                          {due && <div><dt>Due</dt><dd>{formatDate(due)}</dd></div>}
                          <div className="ag-breakdown-total"><dt>They repay</dt><dd>{formatNaira(total)}</dd></div>
                        </dl>
                      )}

                      <FormError message={error} />
                      <div className="ag-flow-actions">
                        <button type="button" className="ui-btn ui-btn--primary ag-flow-cta" disabled={loading || !amt || tooMuch || !selectedRate} onClick={submit}>
                          {loading ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending…</> : amt > 0 ? `Request ${formatNaira(amt, { minor: false })} loan` : 'Request loan'}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <aside className="ag-collect-side">
          <div className="ui-section-head"><h2>Waiting on approval</h2></div>
          {recentLoans === null ? (
            <section className="ui-card"><p className="ui-note ui-note--center">Loading…</p></section>
          ) : recentLoans.length === 0 ? (
            <section className="ui-card"><EmptyState icon="loan" title="No open requests" text="Loans you request show here until they’re paid out." /></section>
          ) : (
            <section className="ui-card ui-card--list">
              {recentLoans.map(l => {
                const st = loanStatus(l.status)
                return (
                  <div key={l.ref} className="ui-row">
                    <span className="ui-row-icon" aria-hidden="true"><Icons.loan size={20} /></span>
                    <span className="ui-row-main">
                      <span className="ui-row-title ui-block">{displayName(l.customer.name)}</span>
                      <span className="ui-row-sub ui-block">{formatNaira(l.principal, { minor: false })} · {l.ref}</span>
                    </span>
                    <span className={`ui-status ui-status--sm ui-status--${st.tone}`}>{st.label}</span>
                  </div>
                )
              })}
            </section>
          )}
          <ul className="ag-rules" aria-label="How loans work">
            <li><Icons.check size={16} aria-hidden="true" /> Up to 80% of what the customer has saved</li>
            <li><Icons.check size={16} aria-hidden="true" /> One loan at a time</li>
            <li><Icons.check size={16} aria-hidden="true" /> An admin approves every loan before you pay it out</li>
          </ul>
        </aside>
      </div>
    </div>
  )
}
