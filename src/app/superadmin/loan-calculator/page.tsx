'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { blockMinus, nonNegativeString } from '@/lib/numeric'
import { groupDigits } from '@/lib/format'
import { Icons } from '@/components/ui/icons'
import { Empty, Field, PageHeader, naira } from '../_components/admin-ui'

interface Rate {
  durationDays: number
  label: string
  rate: number
}

const PRESETS = [10000, 20000, 50000, 100000, 200000, 500000]

// The same sums this page has always used: simple interest at the term's rate.
function quote(principal: number, rate: number, days: number) {
  const interest = Math.round(principal * rate / 100)
  const total = principal + interest
  return {
    interest,
    total,
    daily: days > 0 ? Math.round(total / days) : 0,
    weekly: days > 0 ? Math.round(total / (days / 7)) : 0,
    monthly: days > 0 ? Math.round(total / (days / 30)) : 0,
    apr: days > 0 ? ((rate / 100) * (365 / days) * 100).toFixed(1) : '0',
  }
}

export default function LoanCalculatorPage() {
  const [rates, setRates] = useState<Rate[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const [principalStr, setPrincipalStr] = useState('50000')
  const [selectedTerm, setSelectedTerm] = useState(90)
  const [customRateStr, setCustomRateStr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch('/api/admin/interest-rates')
      if (!res.ok) throw new Error()
      const { rates: r } = await res.json() as { rates?: Rate[] }
      setRates(r ?? [])
      if (r?.length) setSelectedTerm(r[0].durationDays)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const principal = Math.max(0, Number(principalStr) || 0)
  const selectedRate = rates.find(r => r.durationDays === selectedTerm)
  const customRate = customRateStr === '' ? null : Math.max(0, parseFloat(customRateStr) || 0)
  const rate = customRate !== null ? customRate : (selectedRate?.rate ?? 0)
  const q = quote(principal, rate, selectedTerm)
  const principalPct = q.total > 0 ? principal / q.total * 100 : 0
  const interestPct = q.total > 0 ? q.interest / q.total * 100 : 0

  function pickTerm(days: number) {
    setSelectedTerm(days)
    setCustomRateStr('')
  }

  return (
    <>
      <PageHeader title="Loan calculator" sub="Work out what a customer would repay for any amount and term. Nothing here is saved or sent." />

      <div className="lo-calc">
        <section className="card" aria-labelledby="lc-in">
          <div className="card-hd"><h3 id="lc-in">Loan details</h3></div>

          <Field id="lc-amount" label="Amount to borrow">
            <div className="lo-affix lo-affix--pre lo-big">
              <span className="lo-pre" aria-hidden="true">₦</span>
              <input id="lc-amount" className="a-input" type="tel" inputMode="decimal" autoComplete="off"
                value={groupDigits(principalStr)} placeholder="50,000" onKeyDown={blockMinus}
                onChange={e => setPrincipalStr(nonNegativeString(e.target.value))} />
            </div>
            <div className="lo-chips" role="group" aria-label="Common amounts">
              {PRESETS.map(v => (
                <button key={v} type="button" className="lo-chip" aria-pressed={principal === v} onClick={() => setPrincipalStr(String(v))}>
                  {naira(v)}
                </button>
              ))}
            </div>
          </Field>

          <fieldset className="a-field lo-fieldset">
            <legend className="a-label">Term</legend>
            {loading ? (
              <div className="lo-terms" aria-busy="true" aria-label="Loading terms">
                {[0, 1, 2, 3].map(i => <span key={i} className="skel lo-terms-skel" />)}
              </div>
            ) : failed ? (
              <div className="a-alert a-alert-r lo-inline-err" role="alert">
                <span>We couldn’t load the interest rates. You can still enter a rate below.</span>
                <button type="button" className="btn btn-outline btn-sm" onClick={load}><Icons.retry size={16} aria-hidden="true" /> Try again</button>
              </div>
            ) : rates.length === 0 ? (
              <Empty icon="rate" title="No loan terms set up" text={<>Set the interest rate for each term under <Link href="/superadmin/settings/interest">Settings → Interest rates</Link>, or enter a rate below.</>} />
            ) : (
              <div className="lo-terms">
                {rates.map(r => (
                  <button key={r.durationDays} type="button" className="lo-term" aria-pressed={selectedTerm === r.durationDays} onClick={() => pickTerm(r.durationDays)}>
                    <span>
                      <span className="lo-term-days">{r.durationDays} days</span>
                      <span className="lo-term-sub">{r.label} · {r.rate}% interest</span>
                    </span>
                    <Icons.check size={18} className="lo-term-check" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <Field id="lc-rate" label="Use a different rate (optional)"
            hint={customRate !== null ? `Using ${customRate}% instead of the ${selectedRate ? `${selectedRate.rate}% set for ${selectedTerm} days` : 'term rate'}.` : 'Leave empty to use the rate set for the term.'}>
            <div className="lo-rate-row">
              <div className="lo-affix lo-affix--suf">
                <input id="lc-rate" className="a-input" type="tel" inputMode="decimal" autoComplete="off"
                  value={customRateStr} placeholder={`${selectedRate?.rate ?? 0}`} onKeyDown={blockMinus}
                  onChange={e => setCustomRateStr(nonNegativeString(e.target.value))} />
                <span className="lo-suf" aria-hidden="true">%</span>
              </div>
              {customRate !== null && <button type="button" className="btn btn-outline" onClick={() => setCustomRateStr('')}>Reset</button>}
            </div>
          </Field>
        </section>

        <div className="lo-stack" aria-live="polite">
          <section className="card" aria-labelledby="lc-total">
            <div className="lo-total-lbl" id="lc-total">Total to repay</div>
            <div className="lo-total">{naira(q.total)}</div>
            <p className="lo-total-sub">{naira(principal)} borrowed + {naira(q.interest)} interest ({rate}% for {selectedTerm} days)</p>
          </section>

          <div className="lo-cadence">
            <div className="stat"><div className="stat-lbl">Daily</div><div className="stat-val">{naira(q.daily)}</div></div>
            <div className="stat"><div className="stat-lbl">Weekly</div><div className="stat-val">{naira(q.weekly)}</div></div>
            <div className="stat"><div className="stat-lbl">Monthly</div><div className="stat-val">{naira(q.monthly)}</div></div>
          </div>

          <section className="card" aria-labelledby="lc-split">
            <div className="card-hd"><h3 id="lc-split">What the total is made of</h3></div>
            <div className="lo-bar" role="img" aria-label={`Amount borrowed ${principalPct.toFixed(1)}%, interest ${interestPct.toFixed(1)}% of the total`}>
              <span className="lo-bar-p" style={{ width: `${principalPct}%` }} />
              <span className="lo-bar-i" style={{ width: `${interestPct}%` }} />
            </div>
            <dl className="lo-legend">
              <div><dt><span className="lo-swatch lo-bar-p" aria-hidden="true" />Borrowed</dt><dd>{naira(principal)}<span>{principalPct.toFixed(1)}%</span></dd></div>
              <div><dt><span className="lo-swatch lo-bar-i" aria-hidden="true" />Interest</dt><dd>{naira(q.interest)}<span>{interestPct.toFixed(1)}%</span></dd></div>
            </dl>
          </section>

          <section className="card" aria-label="Loan cost">
            <dl className="lo-facts">
              <div><dt>Yearly rate (APR)</dt><dd>{q.apr}%</dd></div>
              <div><dt>Cost per ₦1,000</dt><dd>₦{(rate * 10).toFixed(0)}</dd></div>
              <div><dt>Term</dt><dd>{selectedTerm} days</dd></div>
            </dl>
          </section>
        </div>
      </div>

      <section className="card" aria-labelledby="lc-compare">
        <div className="card-hd"><h3 id="lc-compare">Compare terms for {naira(principal)}</h3></div>
        {loading ? <div className="a-tbl-skel" aria-busy="true" aria-label="Loading">{[0, 1, 2, 3].map(i => <div key={i} className="a-tbl-skel-row"><span className="skel lo-terms-skel" /></div>)}</div>
          : failed ? <Empty icon="error" danger title="We couldn’t load the interest rates" text="Check your connection and try again."
              action={<button type="button" className="btn btn-outline" onClick={load}><Icons.retry size={16} aria-hidden="true" /> Try again</button>} />
          : rates.length === 0 ? <Empty icon="rate" title="Nothing to compare yet" text="Terms show here once their interest rates are set." />
          : (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Term</th><th className="num">Rate</th><th className="num">Interest</th>
                    <th className="num">Total to repay</th><th className="num">Daily</th><th className="num">APR</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map(r => {
                    const row = quote(principal, r.rate, r.durationDays)
                    const active = selectedTerm === r.durationDays
                    return (
                      <tr key={r.durationDays} className={active ? 'lo-selected' : undefined}>
                        <td>
                          <button type="button" className="lo-pick" aria-pressed={active} onClick={() => pickTerm(r.durationDays)}>
                            {active && <Icons.check size={16} aria-hidden="true" />}{r.durationDays} days
                          </button>
                          <div className="td-sub">{r.label}</div>
                        </td>
                        <td className="num">{r.rate}%</td>
                        <td className="num">{naira(row.interest)}</td>
                        <td className="num lo-strong">{naira(row.total)}</td>
                        <td className="num">{naira(row.daily)}</td>
                        <td className="num">{row.apr}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </>
  )
}
