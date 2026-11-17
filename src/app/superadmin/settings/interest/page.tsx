'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { blockMinus } from '@/lib/numeric'
import { ConfirmModal, Field, LoadError, PageHeader, TableSkeleton, naira, shortDate, useToast } from '../../_components/admin-ui'
import { PctInput, errorOf, nowStr, pct, toDrafts, type Drafts } from '../../_components/rate-fields'

// Settings → Interest rates: loan interest for each loan length, and the savings interest online customers earn.
// Same permission as before the move (savings).

const TERMS = [30, 60, 90, 180] as const
type Term = typeof TERMS[number]
const TERM_LABELS: Record<Term, string> = { 30: 'Short term', 60: 'Standard', 90: 'Medium term', 180: 'Long term' }
const DEFAULT_RATES: Record<Term, number> = { 30: 5, 60: 8, 90: 12, 180: 18 }
/** A loan tier's cap and on/off state. The POST is a full-state write, so both go back with every save. */
type Tier = { cap: number | null; on: boolean }
const DEFAULT_TIERS: Record<Term, Tier> = { 30: { cap: null, on: true }, 60: { cap: null, on: true }, 90: { cap: null, on: true }, 180: { cap: null, on: true } }
const capDrafts = (t: Record<Term, Tier>) => Object.fromEntries(TERMS.map(k => [k, t[k].cap === null ? '' : String(t[k].cap)])) as Drafts<Term>
/** Blank is no cap (null); otherwise a whole naira amount 0 or more. undefined = invalid. */
const capOf = (s: string): number | null | undefined => { if (s.trim() === '') return null; const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : undefined }
/** GET /api/admin/savings-interest: the current annual rate and its change history (forward-only). */
interface SavingsRateData { current: number; history: { effectiveFrom: string; annualRate: number }[] }

type Confirm = { kind: 'loan' } | { kind: 'savings' }

export default function InterestSettingsPage() {
  const [loanFailed, setLoanFailed] = useState(false)
  const [loanLoaded, setLoanLoaded] = useState(false)
  // Drafts are filled from the server once; a retry after a failure mustn't wipe unsaved edits.
  const loanInit = useRef(false)
  const [toastNode, toast] = useToast()
  const [savedLoan, setSavedLoan] = useState<Record<Term, number>>({ ...DEFAULT_RATES })
  const [loanRates, setLoanRates] = useState<Drafts<Term>>(toDrafts(DEFAULT_RATES))
  const [savedTiers, setSavedTiers] = useState<Record<Term, Tier>>(DEFAULT_TIERS)
  const [loanCaps, setLoanCaps] = useState<Drafts<Term>>(capDrafts(DEFAULT_TIERS))
  const [loanOn, setLoanOn] = useState<Record<Term, boolean>>({ 30: true, 60: true, 90: true, 180: true })
  const [lastSavedLoan, setLastSavedLoan] = useState('')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [savingsRate, setSavingsRate] = useState<SavingsRateData | null>(null)
  const [savingsRateFailed, setSavingsRateFailed] = useState(false)
  const [newSavingsRate, setNewSavingsRate] = useState('')

  const load = useCallback(async () => {
    setLoanFailed(false)
    const loan = await fetch('/api/admin/interest-rates').then(r => r.ok ? r.json() as Promise<{ rates?: { durationDays: number; rate: number; maxAmount?: number | null; enabled?: boolean }[] }> : null).catch(() => null)
    setLoanFailed(!loan || !Array.isArray(loan.rates))
    if (loan && Array.isArray(loan.rates)) {
      const next: Record<Term, number> = { ...DEFAULT_RATES }
      const tiers: Record<Term, Tier> = { ...DEFAULT_TIERS }
      loan.rates.forEach(r => {
        if (!(TERMS as readonly number[]).includes(r.durationDays)) return
        next[r.durationDays as Term] = r.rate
        tiers[r.durationDays as Term] = { cap: typeof r.maxAmount === 'number' ? r.maxAmount : null, on: r.enabled !== false }
      })
      setSavedLoan(next); setSavedTiers(tiers); setLoanLoaded(true)
      if (!loanInit.current) {
        loanInit.current = true
        setLoanRates(toDrafts(next)); setLoanCaps(capDrafts(tiers))
        setLoanOn(Object.fromEntries(TERMS.map(t => [t, tiers[t].on])) as Record<Term, boolean>)
      }
    }
  }, [])

  const loadSavingsRate = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/savings-interest')
      if (!res.ok) throw new Error()
      setSavingsRate(await res.json() as SavingsRateData)
      setSavingsRateFailed(false)
    } catch { setSavingsRateFailed(true) }
  }, [])

  useEffect(() => { load(); loadSavingsRate() }, [load, loadSavingsRate])

  async function handleSetSavingsRate() {
    const rate = pct(newSavingsRate)
    if (rate === null) { setConfirmError('Enter a rate from 0 to 100.'); return }
    setBusy(true); setConfirmError('')
    try {
      const res = await fetch('/api/admin/savings-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annualRate: rate }),
      })
      if (!res.ok) { setConfirmError(await errorOf(res, 'The rate wasn’t changed. Try again.')); return }
      setConfirm(null); setNewSavingsRate('')
      toast(`Savings interest is now ${rate}% a year`, 'success')
      await loadSavingsRate()
    } catch {
      setConfirmError('No connection. Check your internet and try again.')
    } finally {
      setBusy(false)
    }
  }

  const loanParsed = Object.fromEntries(TERMS.map(t => [t, pct(loanRates[t])])) as Record<Term, number | null>
  const capParsed = Object.fromEntries(TERMS.map(t => [t, capOf(loanCaps[t])])) as Record<Term, number | null | undefined>
  const loanValid = TERMS.every(t => loanParsed[t] !== null && capParsed[t] !== undefined)
  const loanChanges = TERMS.filter(t => loanParsed[t] !== savedLoan[t] || capParsed[t] !== savedTiers[t].cap || loanOn[t] !== savedTiers[t].on)
  const capText = (c: number | null | undefined) => c == null ? 'No cap' : naira(c)
  const maxLoanRate = Math.max(...TERMS.map(t => loanParsed[t] ?? 0))

  function openConfirm(c: Confirm) { setConfirmError(''); setConfirm(c) }

  async function handleSaveLoanRates() {
    if (!loanValid) return
    setBusy(true); setConfirmError('')
    // Full-state write: a row sent without maxAmount/enabled is reset, so every tier sends both.
    const rates = TERMS.map(d => ({ durationDays: d, rate: loanParsed[d] as number, maxAmount: capParsed[d] ?? null, enabled: loanOn[d] }))
    try {
      const res = await fetch('/api/admin/interest-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates }),
      })
      if (!res.ok) { setConfirmError(await errorOf(res, 'The loan rates weren’t saved. Nothing changed. Try again.')); return }
      const next = Object.fromEntries(rates.map(r => [r.durationDays, r.rate])) as Record<Term, number>
      setSavedLoan(next)
      setSavedTiers(Object.fromEntries(rates.map(r => [r.durationDays, { cap: r.maxAmount, on: r.enabled }])) as Record<Term, Tier>)
      setLastSavedLoan(`Saved at ${nowStr()}`)
      setConfirm(null)
      toast('Loan interest rates saved. New loan requests use them from now on.', 'success')
    } catch {
      setConfirmError('No connection. Check your internet and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Interest rates" sub="Loan interest for each loan length, and the interest online customers earn on savings." />

      {/* Loan interest */}
      <section className="card am-section" aria-labelledby="loan-h">
        <div className="card-hd">
          <div>
            <h3 id="loan-h">Loan interest rates</h3>
            <p className="am-card-sub">Interest charged on each loan length.</p>
          </div>
        </div>
        {!loanLoaded ? (loanFailed ? <LoadError what="loan interest rates" onRetry={load} /> : <TableSkeleton rows={2} cols={4} />)
          : (
            <>
              <div className="am-terms">
                {TERMS.map(term => {
                  const rate = loanParsed[term]
                  const interest = 50000 * (rate ?? 0) / 100
                  const capBad = capParsed[term] === undefined
                  return (
                    <div key={term} className={`am-term${loanOn[term] ? '' : ' am-term--off'}`}>
                      <div className="am-term-hd am-term-hd--row">
                        <div><strong>{term} days</strong><span>{TERM_LABELS[term]}</span></div>
                        <label className="cs-check">
                          <input type="checkbox" checked={loanOn[term]} onChange={e => setLoanOn(o => ({ ...o, [term]: e.target.checked }))} />
                          <span>Offered<span className="sr-only"> for {term} day loans</span></span>
                        </label>
                      </div>
                      <Field id={`lr-${term}`} label="Interest rate" error={rate === null ? 'Enter 0 to 100.' : undefined}>
                        <PctInput id={`lr-${term}`} value={loanRates[term]} invalid={rate === null} onChange={s => setLoanRates(r => ({ ...r, [term]: s }))} />
                      </Field>
                      <Field id={`lc-${term}`} label="Largest loan" hint={capBad ? undefined : 'Larger requests are refused. Leave blank for no cap.'} error={capBad ? 'Enter an amount, or leave blank.' : undefined}>
                        <div className="am-money">
                          <span aria-hidden="true">₦</span>
                          <input id={`lc-${term}`} className="a-input" type="tel" inputMode="numeric" autoComplete="off" placeholder="No cap" value={loanCaps[term]} aria-invalid={capBad || undefined}
                            onKeyDown={blockMinus} onChange={e => { const v = e.target.value.replace(/\D/g, ''); setLoanCaps(c => ({ ...c, [term]: v })) }} />
                        </div>
                      </Field>
                      <p className="am-term-eg">{loanOn[term]
                        ? <>A ₦50,000 loan is repaid as <strong>{naira(50000 + interest)}</strong>, which is {naira(interest)} interest over {term} days.</>
                        : <>Turned off. New loan requests for {term} days are refused.</>}</p>
                    </div>
                  )
                })}
              </div>

              <div className="am-bars" aria-label="Rate comparison">
                <p className="am-bars-h">Compared</p>
                {TERMS.map(term => (
                  <div key={term} className="am-bar-row">
                    <span className="am-bar-lbl">{term} days</span>
                    <div className="progress-bar" aria-hidden="true">
                      <div className="progress-fill" style={{ width: `${maxLoanRate > 0 ? ((loanParsed[term] ?? 0) / maxLoanRate) * 100 : 0}%` }} />
                    </div>
                    <span className="am-bar-val">{loanParsed[term] ?? '—'}%</span>
                  </div>
                ))}
              </div>

              <div className="am-foot">
                <div className="am-foot-info">
                  <span>New loan requests use these rates. Loans already approved keep the rate they were given.</span>
                  {lastSavedLoan && <span>{lastSavedLoan}</span>}
                </div>
                <div className="am-foot-actions">
                  <button type="button" className="btn btn-outline" onClick={() => { setLoanRates(toDrafts(DEFAULT_RATES)); toast('Default rates filled in. Save to apply them.') }}>Use defaults</button>
                  <button type="button" className="btn btn-green" disabled={!loanValid || loanChanges.length === 0} onClick={() => openConfirm({ kind: 'loan' })}>
                    {loanChanges.length === 0 ? 'No changes' : 'Save loan rates'}
                  </button>
                </div>
              </div>
            </>
          )}
      </section>

      {/* Savings interest (online plans) */}
      <section className="card am-section" aria-labelledby="si-h">
        <div className="card-hd">
          <div>
            <h3 id="si-h">Savings interest rate</h3>
            <p className="am-card-sub">Paid to online customers on their savings. Cash (agent) plans don’t earn interest.</p>
          </div>
          {savingsRate && <span className="am-rate-now">{savingsRate.current}% <span>a year</span></span>}
        </div>
        {!savingsRate ? (savingsRateFailed ? <LoadError what="the savings interest rate" onRetry={loadSavingsRate} /> : <TableSkeleton rows={2} cols={2} />)
          : (
            <>
              <div className="am-terms">
                <div className="am-term">
                  <Field id="si-new" label="New rate (% a year)" error={newSavingsRate !== '' && pct(newSavingsRate) === null ? 'Enter 0 to 100.' : undefined}>
                    <PctInput id="si-new" value={newSavingsRate} invalid={newSavingsRate !== '' && pct(newSavingsRate) === null} onChange={setNewSavingsRate} />
                  </Field>
                  <p className="am-term-eg">At {pct(newSavingsRate) ?? savingsRate.current}% a year, ₦100,000 held for a month earns <strong>{naira(100000 * (pct(newSavingsRate) ?? savingsRate.current) / 100 / 12)}</strong>.</p>
                </div>
                <div className="am-term">
                  <div className="am-term-hd"><strong>Rate history</strong></div>
                  {savingsRate.history.length === 0
                    ? <p className="am-term-eg">No changes yet. The default of {savingsRate.current}% applies.</p>
                    : (
                      <dl className="dlg-ledger">
                        {[...savingsRate.history].reverse().slice(0, 6).map(h => (
                          <div key={h.effectiveFrom + h.annualRate}><dt>From {shortDate(h.effectiveFrom)}</dt><dd>{h.annualRate}%</dd></div>
                        ))}
                      </dl>
                    )}
                </div>
              </div>
              <div className="am-foot">
                <div className="am-foot-info"><span>Applies from now on. Interest already earned isn’t changed.</span></div>
                <div className="am-foot-actions">
                  <button type="button" className="btn btn-green" disabled={pct(newSavingsRate) === null || pct(newSavingsRate) === savingsRate.current}
                    onClick={() => openConfirm({ kind: 'savings' })}>Set rate</button>
                </div>
              </div>
            </>
          )}
      </section>

      {confirm?.kind === 'loan' && (
        <ConfirmModal icon="rate" title="Save loan interest rates?" confirmLabel="Save loan rates" busy={busy} error={confirmError}
          body={<>
            New loan requests use these rates. Loans already approved keep their rate.
            <ul className="am-diff">
              {loanChanges.flatMap(t => [
                loanParsed[t] !== savedLoan[t] && <li key={`${t}-r`}><span>{t} days rate</span><span className="am-diff-val"><span className="am-diff-old">{savedLoan[t]}%</span>{loanParsed[t]}%</span></li>,
                capParsed[t] !== savedTiers[t].cap && <li key={`${t}-c`}><span>{t} days largest loan</span><span className="am-diff-val"><span className="am-diff-old">{capText(savedTiers[t].cap)}</span>{capText(capParsed[t])}</span></li>,
                loanOn[t] !== savedTiers[t].on && <li key={`${t}-o`}><span>{t} days</span><span className="am-diff-val"><span className="am-diff-old">{savedTiers[t].on ? 'Offered' : 'Off'}</span>{loanOn[t] ? 'Offered' : 'Off'}</span></li>,
              ].filter(Boolean))}
            </ul>
          </>}
          onConfirm={handleSaveLoanRates} onClose={() => setConfirm(null)} />
      )}

      {confirm?.kind === 'savings' && savingsRate && (
        <ConfirmModal icon="rate" title="Change the savings interest rate?" confirmLabel="Set rate" busy={busy} error={confirmError}
          body={<>
            Online customers earn the new rate from now on. Interest already earned isn’t changed.
            <ul className="am-diff">
              <li><span>Annual rate</span><span className="am-diff-val"><span className="am-diff-old">{savingsRate.current}%</span>{pct(newSavingsRate)}%</span></li>
            </ul>
          </>}
          onConfirm={handleSetSavingsRate} onClose={() => setConfirm(null)} />
      )}

      {toastNode}
    </>
  )
}
