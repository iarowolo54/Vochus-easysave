'use client'

import { useState, useEffect } from 'react'
import { blockMinus, nonNegativeString } from '@/lib/numeric'

interface Rate { id: string; durationDays: number; label: string; rate: number }

export default function InterestRatesPage() {
  const [rates, setRates] = useState<Rate[]>([])
  const [loading, setLoading] = useState(true)
  const [principal, setPrincipal] = useState('')
  const [calcRate, setCalcRate] = useState<Rate | null>(null)

  useEffect(() => {
    fetch('/api/interest-rates').then(r => r.json()).then(d => {
      setRates(d.rates ?? [])
      if (d.rates?.length) setCalcRate(d.rates[0])
      setLoading(false)
    })
  }, [])

  const calcInterest = calcRate && principal ? (parseFloat(principal) * calcRate.rate) / 100 : 0
  const calcTotal = parseFloat(principal || '0') + calcInterest

  return (
    <>
      <div className="page-header">
        <h2>Interest Rates &amp; Schedule</h2>
        <p>Current loan rates and penalty structures</p>
      </div>

      <div className="grid g-2-1">
        <div>
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-title">Rate Schedule by Tenure</div>
            {loading && <div style={{ textAlign: 'center', color: 'var(--mu)', padding: 16 }}>Loading…</div>}
            {!loading && (
              <div className="table-wrap"><table>
                <thead><tr><th>Tenure</th><th>Flat Rate</th><th>Example (₦10K)</th></tr></thead>
                <tbody>
                  {rates.map(r => (
                    <tr key={r.id}>
                      <td><strong>{r.label}</strong></td>
                      <td><span style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 18, fontWeight: 800, color: 'var(--gd)' }}>{r.rate}%</span></td>
                      <td style={{ color: 'var(--gd)' }}>Repay ₦{(10000 + 10000 * r.rate / 100).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--mu)', display: 'flex', alignItems: 'center', gap: 5 }}>
              🔒 Rates are set by the administrator and cannot be changed here.
            </div>
          </div>
          <div className="card">
            <div className="card-title">Penalty &amp; Late Payment</div>
            <div className="table-wrap"><table>
              <thead><tr><th>Scenario</th><th>Penalty</th><th>Notes</th></tr></thead>
              <tbody>
                <tr><td><strong>Late (1–7 days)</strong></td><td><span style={{ color: 'var(--rd)', fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800 }}>1% / day</span></td><td style={{ color: 'var(--mu)' }}>Automatic charge</td></tr>
                <tr><td><strong>Default (8+ days)</strong></td><td><span style={{ color: 'var(--rd)', fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800 }}>2% / day</span></td><td style={{ color: 'var(--mu)' }}>Escalates to admin</td></tr>
                <tr><td><strong>Early Repayment</strong></td><td><span style={{ color: 'var(--g)', fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 800 }}>0%</span></td><td style={{ color: 'var(--mu)' }}>No penalty</td></tr>
              </tbody>
            </table></div>
          </div>
        </div>
        <div>
          <div className="card">
            <div className="card-title">Loan Calculator</div>
            <label className="flabel">Principal Amount (₦)</label>
            <input
              className="finput" type="tel" inputMode="decimal" onKeyDown={blockMinus} placeholder="Enter amount"
              style={{ fontSize: 22, fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, textAlign: 'center', padding: 14, marginBottom: 14 }}
              value={principal} onChange={e => setPrincipal(nonNegativeString(e.target.value))}
            />
            <label className="flabel">Duration</label>
            <select className="finput" style={{ marginBottom: 14 }} onChange={e => setCalcRate(rates.find(r => r.id === e.target.value) ?? null)}>
              {rates.map(r => <option key={r.id} value={r.id}>{r.label} — {r.rate}%</option>)}
            </select>
            {principal && calcRate && (
              <div className="conf-table" style={{ marginTop: 8 }}>
                <div className="conf-row"><span className="conf-lbl">Interest</span><strong style={{ color: 'var(--gd)' }}>₦{calcInterest.toLocaleString()}</strong></div>
                <div className="conf-row"><span className="conf-lbl">Total Repayable</span><strong style={{ color: 'var(--gd)', fontSize: 16 }}>₦{calcTotal.toLocaleString()}</strong></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
