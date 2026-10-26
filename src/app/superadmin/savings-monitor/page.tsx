'use client'

import { useState, useEffect, useCallback } from 'react'

interface SavingsPlan {
  id: string
  customerName: string
  customerId: string
  agentName: string
  agentId: string
  balance: number
  dailyAmount: number
  periodDays: number
  startDate: string
  maturityDate: string
  status: string
  goal: string
}

interface PageData {
  plans: SavingsPlan[]
  total: number
  totalActivePlans: number
  totalSavingsPool: number
  maturingThisWeek: number
  maturingToday: number
}

const TABS = ['All', 'Active', 'Matured', 'Redeemed']

export default function SavingsMonitorPage() {
  const [data, setData] = useState<PageData>({ plans: [], total: 0, totalActivePlans: 0, totalSavingsPool: 0, maturingThisWeek: 0, maturingToday: 0 })
  const [tab, setTab] = useState('All')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [detailRecord, setDetailRecord] = useState<SavingsPlan | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (tab !== 'All') params.set('status', tab)
    if (search) params.set('search', search)
    params.set('page', String(page))
    const res = await fetch(`/api/admin/savings?${params}`)
    if (res.ok) { const d = await res.json(); setData(d) }
    setLoading(false)
  }, [tab, search, page])

  useEffect(() => { setPage(1) }, [tab, search])
  useEffect(() => { load() }, [load])

  const fmt = (n: number) => `₦${n.toLocaleString()}`
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  function maturityBadge(maturityDate: string, status: string) {
    if (status !== 'Active') return null
    const now = new Date()
    const mat = new Date(maturityDate)
    const diff = Math.floor((mat.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (diff <= 0) return <span className="bdg bdg-r" style={{ marginLeft: 6 }}>Today</span>
    if (diff <= 7) return <span className="bdg bdg-a" style={{ marginLeft: 6 }}>{diff}d</span>
    return null
  }

  const totalPages = Math.ceil(data.total / 20)

  const Section = ({ title }: { title: string }) => (
    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase', color: 'var(--text3)', margin: '20px 0 8px', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>{title}</div>
  )
  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)', gap: 12 }}>
      <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', textAlign: 'right' }}>{value ?? '—'}</span>
    </div>
  )

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>Savings Monitor</h1>
          <p>Track all customer savings plans across agents</p>
        </div>
        <div className="a-topbar-search" style={{ minWidth: 260 }}>
          <span style={{ color: 'var(--text3)' }}>🔍</span>
          <input type="text" placeholder="Search customer or ID…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat">
          <span className="stat-ic">📋</span>
          <div className="stat-lbl">Active Plans</div>
          <div className="stat-val green">{data.totalActivePlans.toLocaleString()}</div>
        </div>
        <div className="stat">
          <span className="stat-ic">🏦</span>
          <div className="stat-lbl">Total Savings Pool</div>
          <div className="stat-val blue">{fmt(data.totalSavingsPool)}</div>
        </div>
        <div className="stat">
          <span className="stat-ic">📅</span>
          <div className="stat-lbl">Maturing This Week</div>
          <div className="stat-val amber">{data.maturingThisWeek}</div>
        </div>
        <div className="stat">
          <span className="stat-ic">🔔</span>
          <div className="stat-lbl">Maturing Today</div>
          <div className="stat-val red">{data.maturingToday}</div>
        </div>
      </div>

      <div className="card">
        <div className="tab-bar">
          {TABS.map(t => (
            <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Agent</th>
                <th>Daily Amount</th>
                <th>Period</th>
                <th>Start Date</th>
                <th>Maturity Date</th>
                <th>Balance</th>
                <th>Goal</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td></tr>}
              {!loading && data.plans.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No savings plans found</td></tr>}
              {!loading && data.plans.map(p => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setDetailRecord(p)}>
                  <td>
                    <div className="td-av">
                      <div className="av av-blue">{p.customerName.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
                      <div>
                        <div className="td-name">{p.customerName}</div>
                        <div className="td-sub">{p.customerId}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="td-name">{p.agentName}</div>
                    <div className="td-sub">{p.agentId}</div>
                  </td>
                  <td style={{ fontWeight: 600, color: 'var(--green)' }}>{fmt(p.dailyAmount)}</td>
                  <td style={{ color: 'var(--text2)' }}>{p.periodDays}d</td>
                  <td style={{ color: 'var(--text3)', fontSize: 12 }}>{fmtDate(p.startDate)}</td>
                  <td>
                    <span style={{ fontSize: 12 }}>{fmtDate(p.maturityDate)}</span>
                    {maturityBadge(p.maturityDate, p.status)}
                  </td>
                  <td style={{ fontWeight: 700 }}>{fmt(p.balance)}</td>
                  <td style={{ color: 'var(--text2)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.goal}</td>
                  <td>
                    <span className={`bdg ${p.status === 'Active' ? 'bdg-g' : p.status === 'Matured' ? 'bdg-b' : 'bdg-grey'}`}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>Page {page} of {totalPages}</span>
            <button className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </div>

      {detailRecord && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }} onClick={() => setDetailRecord(null)}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,.45)' }} />
          <div style={{ width: 420, background: 'var(--surface)', height: '100%', overflowY: 'auto', padding: 28, boxShadow: '-8px 0 40px rgba(0,0,0,.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{detailRecord.customerName}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{detailRecord.customerId}</div>
              </div>
              <button className="btn btn-outline btn-xs" onClick={() => setDetailRecord(null)}>✕</button>
            </div>

            <span className={`bdg ${detailRecord.status === 'Active' ? 'bdg-g' : detailRecord.status === 'Matured' ? 'bdg-b' : 'bdg-grey'}`}>{detailRecord.status}</span>

            <Section title="Customer & Agent" />
            <Row label="Agent" value={detailRecord.agentName} />
            <Row label="Agent ID" value={detailRecord.agentId} />

            <Section title="Plan Details" />
            <Row label="Daily Amount" value={<span style={{ color: 'var(--green)', fontWeight: 700 }}>{fmt(detailRecord.dailyAmount)}</span>} />
            <Row label="Period" value={`${detailRecord.periodDays} days`} />
            <Row label="Goal" value={detailRecord.goal} />

            <Section title="Dates" />
            <Row label="Start Date" value={fmtDate(detailRecord.startDate)} />
            <Row label="Maturity Date" value={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {fmtDate(detailRecord.maturityDate)}
                {maturityBadge(detailRecord.maturityDate, detailRecord.status)}
              </span>
            } />

            <Section title="Balance" />
            <Row label="Current Balance" value={<span style={{ fontWeight: 800, fontSize: 15, color: 'var(--blue)' }}>{fmt(detailRecord.balance)}</span>} />
          </div>
        </div>
      )}
    </>
  )
}
