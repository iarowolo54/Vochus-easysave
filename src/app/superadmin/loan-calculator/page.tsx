'use client'

import { useState, useEffect, useCallback } from 'react'
import { blockMinus, nonNegativeString } from '@/lib/numeric'

interface Rate {
  durationDays: number
  label: string
  rate: number
}

const TERM_COLORS: Record<number, string> = { 30: 'var(--green)', 60: 'var(--blue)', 90: 'var(--amber)', 180: 'var(--purple)' }

export default function LoanCalculatorPage() {
  const [rates, setRates] = useState<Rate[]>([])
  const [loading, setLoading] = useState(true)

  const [principal, setPrincipal] = useState(50000)
  const [selectedTerm, setSelectedTerm] = useState(90)
  const [customRate, setCustomRate] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/interest-rates')
    if (res.ok) {
      const { rates: r } = await res.json()
      setRates(r ?? [])
      if (r?.length) setSelectedTerm(r[0].durationDays)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const selectedRate = rates.find(r => r.durationDays === selectedTerm)
  const rate = customRate !== null ? customRate : (selectedRate?.rate ?? 0)
  const interest = Math.round(principal * rate / 100)
  const total = principal + interest
  const dailyRepay = selectedTerm > 0 ? Math.round(total / selectedTerm) : 0
  const weeklyRepay = Math.round(total / (selectedTerm / 7))
  const monthlyRepay = Math.round(total / (selectedTerm / 30))
  const effectiveAPR = selectedTerm > 0 ? ((rate / 100) * (365 / selectedTerm) * 100).toFixed(1) : '0'

  const fmt = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 0 })}`

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>Loan Calculator</h1>
          <p>Compute repayment schedules and affordability for any loan configuration</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        {/* Input panel */}
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 20px' }}>Loan Parameters</h3>

          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.8px', display: 'block', marginBottom: 8 }}>Principal Amount</label>
            <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid var(--border)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden' }}>
              <span style={{ padding: '0 14px', fontSize: 14, fontWeight: 700, color: 'var(--text3)', borderRight: '1px solid var(--border)', background: 'var(--surface2)', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>₦</span>
              <input type="tel" inputMode="numeric" value={principal} onKeyDown={blockMinus}
                onChange={e => setPrincipal(Math.max(0, parseInt(nonNegativeString(e.target.value)) || 0))}
                style={{ flex: 1, border: 'none', outline: 'none', padding: '12px 14px', fontSize: 18, fontWeight: 700, fontFamily: "'IBM Plex Serif', serif", background: 'transparent', color: 'var(--text)' }} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {[10000, 20000, 50000, 100000, 200000, 500000].map(v => (
                <button key={v} onClick={() => setPrincipal(v)}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: `1px solid ${principal === v ? 'var(--green)' : 'var(--border)'}`, background: principal === v ? 'var(--green-lt)' : 'var(--surface2)', color: principal === v ? 'var(--green)' : 'var(--text3)', cursor: 'pointer', fontWeight: 600 }}>
                  {v >= 1000 ? `${v / 1000}K` : v}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.8px', display: 'block', marginBottom: 8 }}>Loan Term</label>
            {loading ? (
              <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading rates…</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
                {rates.map(r => {
                  const color = TERM_COLORS[r.durationDays] ?? 'var(--text)'
                  const active = selectedTerm === r.durationDays
                  return (
                    <button key={r.durationDays} onClick={() => { setSelectedTerm(r.durationDays); setCustomRate(null) }}
                      style={{ padding: '12px 14px', borderRadius: 10, border: `2px solid ${active ? color : 'var(--border)'}`, background: active ? color + '18' : 'var(--surface2)', cursor: 'pointer', textAlign: 'left', transition: 'all .15s' }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: active ? color : 'var(--text)', fontFamily: "'IBM Plex Serif', serif" }}>{r.durationDays} days</div>
                      <div style={{ fontSize: 11.5, color: active ? color : 'var(--text3)', marginTop: 2 }}>{r.label} · {r.rate}% interest</div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.8px', display: 'block', marginBottom: 8 }}>Custom Rate Override (optional)</label>
            <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid var(--border)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden' }}>
              <input type="tel" inputMode="decimal" value={customRate ?? ''} placeholder={`${selectedRate?.rate ?? 0} (from term)`} onKeyDown={blockMinus}
                onChange={e => { const v = nonNegativeString(e.target.value); setCustomRate(v === '' ? null : Math.max(0, parseFloat(v) || 0)) }}
                style={{ flex: 1, border: 'none', outline: 'none', padding: '10px 14px', fontSize: 15, fontFamily: 'IBM Plex Sans, sans-serif', background: 'transparent', color: 'var(--text)' }} />
              <span style={{ padding: '0 14px', fontSize: 13, fontWeight: 700, color: 'var(--text3)', borderLeft: '1px solid var(--border)', background: 'var(--surface2)', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>%</span>
            </div>
          </div>
        </div>

        {/* Results panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 24, margin: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Total Repayment</div>
            <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 900, fontSize: 40, color: TERM_COLORS[selectedTerm] ?? 'var(--green)', lineHeight: 1 }}>{fmt(total)}</div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 8 }}>
              Principal {fmt(principal)} + Interest {fmt(interest)} ({rate}% for {selectedTerm} days)
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            {[
              { label: 'Daily', value: dailyRepay, icon: '📅' },
              { label: 'Weekly', value: weeklyRepay, icon: '📆' },
              { label: 'Monthly', value: monthlyRepay, icon: '🗓️' },
            ].map(({ label, value, icon }) => (
              <div key={label} className="card" style={{ margin: 0, padding: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
                <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 800, fontSize: 18, color: 'var(--text)', marginTop: 4 }}>{fmt(value)}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ margin: 0, padding: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Breakdown</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Principal', value: principal, color: 'var(--blue)', pct: principal / total * 100 },
                { label: 'Interest', value: interest, color: TERM_COLORS[selectedTerm] ?? 'var(--green)', pct: interest / total * 100 },
              ].map(({ label, value, color, pct }) => (
                <div key={label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13 }}>
                    <span style={{ color: 'var(--text2)', fontWeight: 600 }}>{label}</span>
                    <span style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, color }}>{fmt(value)} <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'IBM Plex Sans, sans-serif' }}>({pct.toFixed(1)}%)</span></span>
                  </div>
                  <div style={{ height: 8, background: 'var(--surface3)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 4, background: color, width: `${pct}%`, transition: 'width .4s ease' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ margin: 0, padding: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Effective APR</div>
              <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 800, fontSize: 20, color: 'var(--amber)' }}>{effectiveAPR}%</div>
            </div>
            <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
            <div>
              <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Cost per ₦1,000</div>
              <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 800, fontSize: 20, color: 'var(--text)' }}>₦{(rate * 10).toFixed(0)}</div>
            </div>
            <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
            <div>
              <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Term</div>
              <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 800, fontSize: 20, color: 'var(--text)' }}>{selectedTerm} days</div>
            </div>
          </div>
        </div>
      </div>

      {/* Comparison table */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-hd"><h3>Rate Comparison — ₦{principal.toLocaleString()}</h3></div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Term</th><th>Rate</th><th>Interest</th><th>Total Repayment</th><th>Daily Payment</th><th>Effective APR</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text3)', padding: 20 }}>Loading…</td></tr>}
              {!loading && rates.map(r => {
                const color = TERM_COLORS[r.durationDays] ?? 'var(--text)'
                const i = Math.round(principal * r.rate / 100)
                const t = principal + i
                const daily = Math.round(t / r.durationDays)
                const apr = ((r.rate / 100) * (365 / r.durationDays) * 100).toFixed(1)
                const active = selectedTerm === r.durationDays
                return (
                  <tr key={r.durationDays} style={{ background: active ? color + '10' : undefined }} onClick={() => { setSelectedTerm(r.durationDays); setCustomRate(null) }}>
                    <td style={{ cursor: 'pointer' }}><span style={{ fontWeight: 700, color }}>{r.durationDays} days</span> <span style={{ fontSize: 11, color: 'var(--text3)' }}>{r.label}</span></td>
                    <td style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, color }}>{r.rate}%</td>
                    <td style={{ color: 'var(--text2)' }}>{fmt(i)}</td>
                    <td style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, color: 'var(--text)' }}>{fmt(t)}</td>
                    <td style={{ color: 'var(--text2)' }}>{fmt(daily)}</td>
                    <td style={{ color: 'var(--amber)', fontWeight: 600 }}>{apr}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
