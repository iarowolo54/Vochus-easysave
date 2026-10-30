'use client'

import { useState, useEffect, useCallback } from 'react'
import { blockMinus, nonNegativeString } from '@/lib/numeric'

interface LeaderboardEntry {
  rank: number
  id: string
  agentId: string
  name: string
  status: string
  customerCount: number
  savingsVolume: number
  commissionBalance: number
  photoUrl?: string | null
}

interface PageData {
  totalPending: number
  totalDisbursed: number
  leaderboard: LeaderboardEntry[]
}

const TERM_COLORS: Record<number, string> = { 30: 'var(--green)', 60: 'var(--blue)', 90: 'var(--amber)', 180: 'var(--purple)' }
const TERM_ICONS: Record<number, string> = { 30: '⚡', 60: '📅', 90: '🗓️', 180: '🏦' }
const TERM_LABELS: Record<number, string> = { 30: 'Short-term', 60: 'Standard', 90: 'Medium-term', 180: 'Long-term' }
const DEFAULT_RATES: Record<number, number> = { 30: 5, 60: 8, 90: 12, 180: 18 }
const DEFAULT_MAX: Record<number, number> = { 30: 50000, 60: 100000, 90: 200000, 180: 500000 }
const DEFAULT_COMM = { agentSavings: 0.4, agentLoan: 1.0, agentRepay: 0.5, platformSavings: 1.6, platformLoan: 5.0, platformPenalty: 2.0 }

const PAGE_SIZE = 25

interface SavingsRateData { current: number; history: { effectiveFrom: string; annualRate: number }[] }

export default function CommissionPage() {
  const [data, setData] = useState<PageData>({ totalPending: 0, totalDisbursed: 0, leaderboard: [] })
  const [lbPage, setLbPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [payingOut, setPayingOut] = useState<string | null>(null)
  const [savingLoan, setSavingLoan] = useState(false)
  const [savingComm, setSavingComm] = useState(false)

  const [comm, setComm] = useState(DEFAULT_COMM)
  const [loanRates, setLoanRates] = useState({ ...DEFAULT_RATES })
  const [loanMax, setLoanMax] = useState({ ...DEFAULT_MAX })
  const [loanActive, setLoanActive] = useState<Record<number, boolean>>({ 30: true, 60: true, 90: true, 180: true })
  const [lastSavedComm, setLastSavedComm] = useState('')
  const [lastSavedLoan, setLastSavedLoan] = useState('')

  const [savingsRate, setSavingsRate] = useState<SavingsRateData | null>(null)
  const [savingsRateError, setSavingsRateError] = useState(false)
  const [newSavingsRate, setNewSavingsRate] = useState('')
  const [savingSavingsRate, setSavingSavingsRate] = useState(false)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000) }
  const nowStr = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  const load = useCallback(async () => {
    setLoading(true)
    const [commRes, ratesRes, commRatesRes] = await Promise.all([
      fetch('/api/admin/commission'),
      fetch('/api/admin/interest-rates'),
      fetch('/api/admin/commission/rates'),
    ])
    if (commRes.ok) { const d = await commRes.json(); setData(d) }
    if (ratesRes.ok) {
      const { rates } = await ratesRes.json()
      if (Array.isArray(rates)) {
        const rateMap: Record<number, number> = {}
        rates.forEach((r: { durationDays: number; rate: number }) => { rateMap[r.durationDays] = r.rate })
        setLoanRates(prev => ({ ...prev, ...rateMap }))
      }
    }
    if (commRatesRes.ok) {
      const { rates } = await commRatesRes.json()
      if (rates) setComm(prev => ({ ...prev, ...rates }))
    }
    setLoading(false)
  }, [])

  const loadSavingsRate = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/savings-interest')
      if (!res.ok) throw new Error('failed')
      setSavingsRate(await res.json())
      setSavingsRateError(false)
    } catch { setSavingsRateError(true) }
  }, [])

  useEffect(() => { load(); loadSavingsRate() }, [load, loadSavingsRate])

  async function handleSetSavingsRate() {
    const rate = parseFloat(newSavingsRate)
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) { showToast('Enter a rate between 0 and 100'); return }
    setSavingSavingsRate(true)
    try {
      const res = await fetch('/api/admin/savings-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annualRate: rate }),
      })
      if (res.ok) { setNewSavingsRate(''); showToast('✅ Savings interest rate updated'); await loadSavingsRate() }
      else { const d = await res.json().catch(() => ({})); showToast((d as { error?: string }).error ?? 'Failed to update savings rate') }
    } catch { showToast('Failed to update savings rate') }
    setSavingSavingsRate(false)
  }

  async function handleSaveLoanRates() {
    setSavingLoan(true)
    const rates = ([30, 60, 90, 180] as const).map(d => ({ durationDays: d, rate: loanRates[d] }))
    const res = await fetch('/api/admin/interest-rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rates }),
    })
    setSavingLoan(false)
    if (res.ok) { setLastSavedLoan(`Last saved: Today, ${nowStr()}`); showToast('✅ Loan rates saved successfully') }
    else showToast('Failed to save loan rates')
  }

  const fmt = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 0 })}`
  const fmtK = (n: number) => n >= 1000000 ? `₦${(n / 1000000).toFixed(2)}M` : n >= 1000 ? `₦${(n / 1000).toFixed(0)}K` : fmt(n)
  const totalTakeRate = (comm.agentSavings + comm.platformSavings).toFixed(1)
  const effectiveLoanCost = (comm.agentLoan + comm.platformLoan).toFixed(1)
  const maxLoanRate = Math.max(...Object.values(loanRates))
  const rankMedal = (r: number) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `${r}`

  async function handlePayout(agentId: string, name: string, amount: number) {
    setPayingOut(agentId)
    const res = await fetch('/api/admin/wallets/commission-payout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    })
    setPayingOut(null)
    if (res.ok) { showToast(`💸 ${fmt(amount)} paid to ${name}`); load() }
    else { const d = res.ok ? await res.json() : {}; showToast((d as { error?: string }).error ?? 'Payout failed') }
  }

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>Commission Management</h1>
          <p>Track, approve and disburse agent commissions</p>
        </div>
        <button className="btn btn-green btn-sm" onClick={() => {
          data.leaderboard.filter(a => a.commissionBalance > 0).forEach(a => handlePayout(a.id, a.name, a.commissionBalance))
        }}>💸 Batch Payout</button>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat">
          <span className="stat-ic">🏅</span>
          <div className="stat-lbl">Total Commission</div>
          <div className="stat-val green">{loading ? '…' : fmtK(data.totalPending + data.totalDisbursed)}</div>
          <div className="stat-sub">{data.leaderboard.length} agents</div>
        </div>
        <div className="stat">
          <span className="stat-ic">⏳</span>
          <div className="stat-lbl">Pending Payout</div>
          <div className="stat-val amber">{loading ? '…' : fmt(data.totalPending)}</div>
          <div className="stat-sub">{data.leaderboard.filter(a => a.commissionBalance > 0).length} agents awaiting</div>
        </div>
        <div className="stat">
          <span className="stat-ic">✅</span>
          <div className="stat-lbl">Disbursed</div>
          <div className="stat-val blue">{loading ? '…' : fmtK(data.totalDisbursed)}</div>
          <div className="stat-sub">{data.leaderboard.filter(a => a.commissionBalance === 0).length} agents paid</div>
        </div>
      </div>

      {/* Commission Rate Settings */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-hd">
          <h3>Commission Rate Settings</h3>
          <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400 }}>Configure rates for Savings &amp; Loan products</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Agent Commission */}
          <div style={{ background: 'var(--surface2)', border: '1.5px solid var(--border)', borderRadius: 'var(--r)', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--green-lt)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>🤝</div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>Agent Commission</div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>Applied per agent on verified transactions</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {([
                { key: 'agentSavings', label: 'Savings Commission Rate', sub: 'per savings txn', preview: (v: number) => `On ₦100,000 savings → <strong style="color:var(--green)">₦${(1000 * v).toFixed(2)}</strong> agent commission` },
                { key: 'agentLoan', label: 'Loan Disbursement Commission Rate', sub: 'per loan issued', preview: (v: number) => `On ₦50,000 loan → <strong style="color:var(--green)">₦${(500 * v).toFixed(2)}</strong> agent commission` },
                { key: 'agentRepay', label: 'Loan Repayment Commission Rate', sub: 'per repayment', preview: (v: number) => `On ₦33,600 repayment → <strong style="color:var(--green)">₦${(336 * v).toFixed(2)}</strong> agent commission` },
              ] as { key: keyof typeof DEFAULT_COMM; label: string; sub: string; preview: (v: number) => string }[]).map(({ key, label, sub, preview }) => (
                <div key={key}>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase' as const, letterSpacing: '.8px', display: 'block', marginBottom: 6 }}>{label}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', border: '1.5px solid var(--border)', borderRadius: 9, background: 'var(--surface)', overflow: 'hidden' }}>
                      <input type="tel" inputMode="decimal" value={comm[key]} onKeyDown={blockMinus}
                        onChange={e => setComm(c => ({ ...c, [key]: Math.max(0, parseFloat(nonNegativeString(e.target.value)) || 0) }))}
                        style={{ flex: 1, border: 'none', outline: 'none', padding: '9px 12px', fontSize: 14, fontFamily: 'IBM Plex Sans, sans-serif', background: 'transparent', color: 'var(--text)' }} />
                      <span style={{ padding: '0 12px', color: 'var(--text3)', fontSize: 13, fontWeight: 600, borderLeft: '1px solid var(--border)', background: 'var(--surface2)', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>%</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{sub}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }} dangerouslySetInnerHTML={{ __html: preview(comm[key]) }} />
                </div>
              ))}
            </div>
          </div>

          {/* Platform Commission */}
          <div style={{ background: 'var(--surface2)', border: '1.5px solid var(--border)', borderRadius: 'var(--r)', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--amber-lt)', border: '1px solid rgba(200,132,26,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>🛡️</div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>Platform Commission</div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>Platform revenue retained by Super Admin</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {([
                { key: 'platformSavings', label: 'Savings Platform Fee Rate', sub: 'per savings txn', color: 'var(--amber)', preview: (v: number) => `On ₦100,000 savings → <strong style="color:var(--amber)">₦${(1000 * v).toFixed(2)}</strong> platform fee` },
                { key: 'platformLoan', label: 'Loan Interest Platform Share', sub: 'of loan interest', color: 'var(--amber)', preview: (v: number) => `On ₦3,600 interest earned → <strong style="color:var(--amber)">₦${(36 * v).toFixed(2)}</strong> platform share` },
                { key: 'platformPenalty', label: 'Late Repayment Penalty Fee', sub: 'per late day', color: 'var(--red)', preview: (v: number) => `On ₦50,000 overdue, 3 days → <strong style="color:var(--red)">₦${(50000 * v / 100 * 3).toFixed(2)}</strong> penalty` },
              ] as { key: keyof typeof DEFAULT_COMM; label: string; sub: string; color: string; preview: (v: number) => string }[]).map(({ key, label, sub, preview }) => (
                <div key={key}>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase' as const, letterSpacing: '.8px', display: 'block', marginBottom: 6 }}>{label}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', border: '1.5px solid var(--border)', borderRadius: 9, background: 'var(--surface)', overflow: 'hidden' }}>
                      <input type="tel" inputMode="decimal" value={comm[key]} onKeyDown={blockMinus}
                        onChange={e => setComm(c => ({ ...c, [key]: Math.max(0, parseFloat(nonNegativeString(e.target.value)) || 0) }))}
                        style={{ flex: 1, border: 'none', outline: 'none', padding: '9px 12px', fontSize: 14, fontFamily: 'IBM Plex Sans, sans-serif', background: 'transparent', color: 'var(--text)' }} />
                      <span style={{ padding: '0 12px', color: 'var(--text3)', fontSize: 13, fontWeight: 600, borderLeft: '1px solid var(--border)', background: 'var(--surface2)', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>%</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{sub}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }} dangerouslySetInnerHTML={{ __html: preview(comm[key]) }} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Summary bar */}
        <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>Total take rate on savings: <strong style={{ color: 'var(--green)', fontSize: 14 }}>{totalTakeRate}%</strong></div>
            <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>Effective loan cost to customer: <strong style={{ color: 'var(--amber)', fontSize: 14 }}>{effectiveLoanCost}%</strong></div>
            {lastSavedComm && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{lastSavedComm}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={async () => {
              setComm(DEFAULT_COMM)
              await fetch('/api/admin/commission/rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rates: DEFAULT_COMM }) })
              showToast('↺ Commission rates reset to defaults')
            }}>↺ Reset to Defaults</button>
            <button className="btn btn-green btn-sm" disabled={savingComm} onClick={async () => {
              setSavingComm(true)
              const res = await fetch('/api/admin/commission/rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rates: comm }) })
              setSavingComm(false)
              if (res.ok) { setLastSavedComm(`Last saved: Today, ${nowStr()}`); showToast('✅ Commission rates saved successfully') }
              else showToast('Failed to save commission rates')
            }}>{savingComm ? '…' : '💾 Save Rate Changes'}</button>
          </div>
        </div>
      </div>

      {/* Loan Interest Rate Settings */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-hd">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--blue-lt)', border: '1px solid rgba(26,95,168,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>📊</div>
            <div>
              <h3 style={{ margin: 0 }}>Loan Interest Rate Settings</h3>
              <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400 }}>Configure interest rates per loan term</div>
            </div>
          </div>
          <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>All rates active</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
          {([30, 60, 90, 180] as const).map(term => {
            const color = TERM_COLORS[term]
            const rate = loanRates[term]
            const max = loanMax[term]
            const active = loanActive[term]
            const interest = 50000 * rate / 100
            return (
              <div key={term} style={{ background: 'var(--surface2)', border: `1.5px solid ${active ? color : 'var(--border)'}`, borderRadius: 'var(--r)', padding: 18, opacity: active ? 1 : 0.6, transition: 'border-color .2s,opacity .2s' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: active ? color + '22' : 'var(--surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{TERM_ICONS[term]}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{term} Days</div>
                      <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{TERM_LABELS[term]}</div>
                    </div>
                  </div>
                  <button onClick={() => setLoanActive(a => ({ ...a, [term]: !a[term] }))}
                    style={{ width: 32, height: 18, borderRadius: 100, background: active ? color : 'var(--border)', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
                    <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, right: active ? 2 : 16, transition: 'right .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)', display: 'block' }} />
                  </button>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 5 }}>Interest Rate</div>
                  <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid var(--border)', borderRadius: 8, background: 'var(--surface)', overflow: 'hidden' }}>
                    <input type="tel" inputMode="decimal" value={rate} onKeyDown={blockMinus}
                      onChange={e => setLoanRates(r => ({ ...r, [term]: Math.max(0, parseFloat(nonNegativeString(e.target.value)) || 0) }))}
                      style={{ flex: 1, border: 'none', outline: 'none', padding: '8px 10px', fontSize: 18, fontWeight: 700, fontFamily: "'IBM Plex Serif', serif", color, background: 'transparent', width: 0 }} />
                    <span style={{ padding: '0 10px', fontSize: 13, fontWeight: 700, color, borderLeft: '1px solid var(--border)', background: 'var(--surface2)', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>%</span>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
                  ₦50,000 loan → repay <strong style={{ color }}>{fmt(50000 + interest)}</strong><br />
                  <span>Interest: {fmt(interest)} over {term} days</span>
                </div>
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 5 }}>Max Loan Amount</div>
                  <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid var(--border)', borderRadius: 8, background: 'var(--surface)', overflow: 'hidden' }}>
                    <span style={{ padding: '0 8px', fontSize: 12, fontWeight: 600, color: 'var(--text3)', borderRight: '1px solid var(--border)', background: 'var(--surface2)', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>₦</span>
                    <input type="tel" inputMode="numeric" value={max} onKeyDown={blockMinus}
                      onChange={e => setLoanMax(m => ({ ...m, [term]: Math.max(0, parseInt(nonNegativeString(e.target.value)) || 0) }))}
                      style={{ flex: 1, border: 'none', outline: 'none', padding: '7px 8px', fontSize: 12.5, fontWeight: 600, fontFamily: 'IBM Plex Sans, sans-serif', color: 'var(--text)', background: 'transparent', width: 0 }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Rate comparison bar */}
        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '14px 18px', marginBottom: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text3)', marginBottom: 10 }}>Rate Comparison</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {([30, 60, 90, 180] as const).map(term => (
              <div key={term} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 60, fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', flexShrink: 0 }}>{term} Days</div>
                <div style={{ flex: 1, background: 'var(--surface3)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 4, background: TERM_COLORS[term], width: `${maxLoanRate > 0 ? (loanRates[term] / maxLoanRate) * 100 : 0}%`, transition: 'width .4s ease' }} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: TERM_COLORS[term], width: 36, textAlign: 'right', flexShrink: 0 }}>{loanRates[term]}%</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>
            📋 Rates apply to all new loan requests. Existing approved loans retain their locked-in rate.
            {lastSavedLoan && <span style={{ marginLeft: 6 }}>· {lastSavedLoan}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => { setLoanRates({ ...DEFAULT_RATES }); setLoanMax({ ...DEFAULT_MAX }); showToast('↺ Loan rates reset to defaults') }}>↺ Reset to Defaults</button>
            <button className="btn btn-green btn-sm" disabled={savingLoan} onClick={handleSaveLoanRates}>{savingLoan ? '…' : '💾 Save Loan Rates'}</button>
          </div>
        </div>
      </div>

      {/* Savings Interest Rate */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-hd">
          <div>
            <h3 style={{ margin: 0 }}>Savings interest rate</h3>
            <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400 }}>Annual rate paid to customers on savings plans</div>
          </div>
          <span style={{ fontSize: 22, fontWeight: 800, fontFamily: "'IBM Plex Serif', serif", color: 'var(--green)' }}>
            {savingsRate ? `${savingsRate.current}%` : savingsRateError ? '—' : '…'}
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)' }}> / year</span>
          </span>
        </div>

        {savingsRateError && (
          <div style={{ fontSize: 12.5, color: 'var(--red)', marginBottom: 14 }}>
            Could not load the savings rate. <button className="btn btn-xs btn-outline" onClick={loadSavingsRate}>Retry</button>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.8px', display: 'block', marginBottom: 6 }}>Set new rate (% per year)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', border: '1.5px solid var(--border)', borderRadius: 9, background: 'var(--surface)', overflow: 'hidden' }}>
                <input type="tel" inputMode="decimal" value={newSavingsRate} placeholder="e.g. 10" onKeyDown={blockMinus}
                  onChange={e => setNewSavingsRate(nonNegativeString(e.target.value))}
                  style={{ flex: 1, width: 0, border: 'none', outline: 'none', padding: '9px 12px', fontSize: 14, fontFamily: 'IBM Plex Sans, sans-serif', background: 'transparent', color: 'var(--text)' }} />
                <span style={{ padding: '0 12px', color: 'var(--text3)', fontSize: 13, fontWeight: 600, borderLeft: '1px solid var(--border)', background: 'var(--surface2)', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>%</span>
              </div>
              <button className="btn btn-green btn-sm" disabled={savingSavingsRate || newSavingsRate === ''} onClick={handleSetSavingsRate}>{savingSavingsRate ? '…' : 'Set rate'}</button>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 8, lineHeight: 1.5 }}>
              📋 Effective immediately and forward-only: interest already earned is not restated, and the new rate applies from now on.
            </div>
          </div>

          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text3)', marginBottom: 8 }}>Rate history</div>
            {!savingsRate && !savingsRateError && <div style={{ fontSize: 12, color: 'var(--text3)' }}>Loading…</div>}
            {savingsRate && savingsRate.history.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>No changes yet. The default rate of {savingsRate.current}% applies.</div>
            )}
            {savingsRate && savingsRate.history.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[...savingsRate.history].reverse().slice(0, 6).map(h => (
                  <div key={h.effectiveFrom + h.annualRate} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text2)' }}>{new Date(h.effectiveFrom).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    <strong style={{ color: 'var(--text)' }}>{h.annualRate}%</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="card">
        <div className="card-hd">
          <h3>Commission Leaderboard — {new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' })}</h3>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th><th>Agent</th><th>Customers</th><th>Savings Volume</th><th>Commission</th><th>Status</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td></tr>}
              {!loading && data.leaderboard.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No agents found</td></tr>}
              {!loading && data.leaderboard.slice((lbPage - 1) * PAGE_SIZE, lbPage * PAGE_SIZE).map(a => {
                const initials = a.name.split(' ').map(w => w[0]).join('').slice(0, 2)
                const hasPending = a.commissionBalance > 0
                return (
                  <tr key={a.id}>
                    <td style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 800, color: a.rank <= 3 ? 'var(--amber)' : 'var(--text3)', fontSize: 14 }}>{rankMedal(a.rank)}</td>
                    <td>
                      <div className="td-av">
                        <div className={`av av-${a.rank === 1 ? 'blue' : a.rank === 2 ? 'green' : 'amber'}`} style={{ overflow: 'hidden', padding: 0 }}>{a.photoUrl ? <img src={a.photoUrl} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}</div>
                        <div><div className="td-name">{a.name}</div><div className="td-sub">{a.agentId}</div></div>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text2)' }}>{a.customerCount}</td>
                    <td style={{ color: 'var(--green)', fontWeight: 600 }}>{fmt(a.savingsVolume)}</td>
                    <td style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 800, color: 'var(--green)' }}>{fmt(a.commissionBalance)}</td>
                    <td><span className={`bdg ${hasPending ? 'bdg-a' : 'bdg-g'}`}>{hasPending ? 'Pending' : 'Paid'}</span></td>
                    <td>
                      {hasPending ? (
                        <button className="btn btn-xs btn-green" disabled={payingOut === a.id} onClick={() => handlePayout(a.id, a.name, a.commissionBalance)}>
                          {payingOut === a.id ? '…' : 'Pay Now'}
                        </button>
                      ) : <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        {!loading && Math.ceil(data.leaderboard.length / PAGE_SIZE) > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Showing {(lbPage - 1) * PAGE_SIZE + 1}–{Math.min(lbPage * PAGE_SIZE, data.leaderboard.length)} of {data.leaderboard.length}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn btn-xs btn-outline" disabled={lbPage === 1} onClick={() => setLbPage(p => p - 1)}>← Prev</button>
              <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 80, textAlign: 'center' }}>Page {lbPage} of {Math.ceil(data.leaderboard.length / PAGE_SIZE)}</span>
              <button className="btn btn-xs btn-outline" disabled={lbPage === Math.ceil(data.leaderboard.length / PAGE_SIZE)} onClick={() => setLbPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        )}
        </div>
      </div>

      <div className={`a-toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  )
}
