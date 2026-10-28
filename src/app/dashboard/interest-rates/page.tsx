'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import AmountField from '@/components/ui/AmountField'
import EmptyState from '@/components/ui/EmptyState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Icons } from '@/components/ui/icons'
import { formatDate, formatNaira } from '@/lib/format'

interface Rate { id: string; durationDays: number; label: string; rate: number }

const EXAMPLE = 10000

export default function InterestRatesPage() {
  const [rates, setRates] = useState<Rate[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [principal, setPrincipal] = useState('')
  const [calcRate, setCalcRate] = useState<Rate | null>(null)

  useEffect(() => {
    fetch('/api/interest-rates').then(r => r.json()).then(d => {
      setRates(d.rates ?? [])
      if (d.rates?.length) setCalcRate(d.rates[0])
    }).catch(() => setFailed(true)).finally(() => setLoading(false))
  }, [])

  const amt = parseFloat(principal || '0')
  const calcInterest = calcRate && amt ? (amt * calcRate.rate) / 100 : 0
  const calcTotal = amt + calcInterest
  const due = calcRate ? new Date(Date.now() + calcRate.durationDays * 86400000) : null

  return (
    <div className="ag-page">
      <div className="ag-home-grid ag-wallet-grid">
        <div className="ag-col">
          <div className="ui-section-head"><h2>Loan rates</h2><span className="ui-card-meta">Set by the admin</span></div>
          {loading ? (
            <ListSkeleton count={4} />
          ) : failed ? (
            <section className="ui-card"><EmptyState icon="error" tone="danger" title="Couldn’t load the rates" text="Check your connection and refresh the page." /></section>
          ) : rates.length === 0 ? (
            <section className="ui-card"><EmptyState icon="rate" title="No rates set yet" text="The admin hasn’t added any loan rates." /></section>
          ) : (
            <section className="ui-card ui-card--list" aria-label="Rates by loan length">
              {rates.map(r => (
                <div key={r.id} className="ui-row ag-rate-row">
                  <span className="ag-rate-pct" aria-hidden="true">{r.rate}%</span>
                  <span className="ui-row-main">
                    <span className="ui-row-title ui-block">{r.label}</span>
                    <span className="ui-row-sub ui-block">Borrow {formatNaira(EXAMPLE, { minor: false })}, repay {formatNaira(EXAMPLE + EXAMPLE * r.rate / 100, { minor: false })}</span>
                  </span>
                  <span className="ag-sr">{r.rate}% interest</span>
                </div>
              ))}
            </section>
          )}
          <p className="ag-fineprint ag-rates-note"><Icons.locked size={14} aria-hidden="true" /> Interest is a flat amount on the loan, added once. Only the admin can change these rates.</p>
        </div>

        <div className="ag-col">
          <div className="ui-section-head"><h2>Work out a loan</h2></div>
          <section className="ui-card ag-topup">
            <AmountField value={principal} onChange={setPrincipal} label="Loan amount in naira" hint="How much the customer wants to borrow" />
            {rates.length > 0 && (
              <div className="ag-quick" role="group" aria-label="Loan length">
                {rates.map(r => (
                  <button key={r.id} type="button" className="ag-chip" aria-pressed={calcRate?.id === r.id} onClick={() => setCalcRate(r)}>{r.label}</button>
                ))}
              </div>
            )}
            <dl className="ag-breakdown">
              <div><dt>Loan</dt><dd>{amt > 0 ? formatNaira(amt) : '—'}</dd></div>
              <div><dt>Interest{calcRate ? ` (${calcRate.rate}%)` : ''}</dt><dd>{amt > 0 ? formatNaira(calcInterest) : '—'}</dd></div>
              {due && amt > 0 && <div><dt>Due</dt><dd>{formatDate(due)}</dd></div>}
              <div className="ag-breakdown-total"><dt>They repay</dt><dd>{amt > 0 ? formatNaira(calcTotal) : '—'}</dd></div>
            </dl>
            <Link href="/dashboard/loan-request" className="ui-btn ui-btn--secondary ui-btn--block"><Icons.loan size={18} aria-hidden="true" /> Request a loan</Link>
          </section>
        </div>
      </div>
    </div>
  )
}
