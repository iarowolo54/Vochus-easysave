'use client'

import { useState, useEffect, useCallback } from 'react'

interface Repayment {
  id: string
  loanRef: string
  amount: number
  method: string
  customerName: string
  customerId: string
  agentName: string
  agentId: string
  createdAt: string
}

export default function LoanRepayPage() {
  const [repayments, setRepayments] = useState<Repayment[]>([])
  const [stats, setStats] = useState({ totalRepayments: 0, totalAmount: 0, todayCount: 0, todayAmount: 0 })
  const [search, setSearch] = useState('')
  const [date, setDate] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [detailRecord, setDetailRecord] = useState<Repayment | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (date) params.set('date', date)
    const res = await fetch(`/api/admin/loan-repayments?${params}`)
    const d = res.ok ? await res.json() : {}
    setRepayments(d.repayments ?? [])
    setPage(1)
    setStats({
      totalRepayments: d.totalRepayments ?? 0,
      totalAmount: d.totalAmount ?? 0,
      todayCount: d.todayCount ?? 0,
      todayAmount: d.todayAmount ?? 0,
    })
    setLoading(false)
  }, [search, date])

  useEffect(() => { load() }, [load])

  const fmt = (n: number) => `₦${n.toLocaleString()}`
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const PAGE_SIZE = 25
  const paginated = repayments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(repayments.length / PAGE_SIZE)

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
          <h1>Loan Repayments</h1>
          <p>All loan repayment records across agents</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat">
          <span className="stat-ic">🔄</span>
          <div className="stat-lbl">Total Repayments</div>
          <div className="stat-val blue">{stats.totalRepayments.toLocaleString()}</div>
        </div>
        <div className="stat">
          <span className="stat-ic">💰</span>
          <div className="stat-lbl">Total Amount</div>
          <div className="stat-val green">{fmt(stats.totalAmount)}</div>
        </div>
        <div className="stat">
          <span className="stat-ic">📅</span>
          <div className="stat-lbl">Today's Count</div>
          <div className="stat-val amber">{stats.todayCount}</div>
        </div>
        <div className="stat">
          <span className="stat-ic">📈</span>
          <div className="stat-lbl">Today's Amount</div>
          <div className="stat-val green">{fmt(stats.todayAmount)}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="a-topbar-search" style={{ minWidth: 240 }}>
            <span style={{ color: 'var(--text3)' }}>🔍</span>
            <input type="text" placeholder="Search loan ref, customer, agent…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ padding: '7px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, fontFamily: 'IBM Plex Sans', background: 'var(--surface2)', color: 'var(--text)' }} />
          {(search || date) && <button className="btn btn-outline btn-sm" onClick={() => { setSearch(''); setDate('') }}>Clear</button>}
        </div>
      </div>

      <div className="card">
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>{repayments.length} repayments shown</div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Loan Ref</th>
                <th>Customer</th>
                <th>Agent</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td></tr>}
              {!loading && repayments.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No repayments found</td></tr>}
              {!loading && paginated.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetailRecord(r)}>
                  <td><strong style={{ fontSize: 12, color: 'var(--purple)' }}>{r.loanRef}</strong></td>
                  <td>
                    <div className="td-av">
                      <div className="av av-blue">{r.customerName.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
                      <div>
                        <div className="td-name">{r.customerName}</div>
                        <div className="td-sub">{r.customerId}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="td-name">{r.agentName}</div>
                    <div className="td-sub">{r.agentId}</div>
                  </td>
                  <td><span style={{ fontWeight: 700, color: 'var(--green)' }}>{fmt(r.amount)}</span></td>
                  <td style={{ color: 'var(--text2)', fontSize: 12 }}>{r.method}</td>
                  <td style={{ color: 'var(--text3)', fontSize: 12 }}>{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, repayments.length)} of {repayments.length}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn btn-xs btn-outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 80, textAlign: 'center' }}>Page {page} of {totalPages}</span>
              <button className="btn btn-xs btn-outline" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        )}
        </div>
      </div>

      {detailRecord && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }} onClick={() => setDetailRecord(null)}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,.45)' }} />
          <div style={{ width: 420, background: 'var(--surface)', height: '100%', overflowY: 'auto', padding: 28, boxShadow: '-8px 0 40px rgba(0,0,0,.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--purple)', fontFamily: 'monospace' }}>{detailRecord.loanRef}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>Loan Repayment</div>
              </div>
              <button className="btn btn-outline btn-xs" onClick={() => setDetailRecord(null)}>✕</button>
            </div>

            <Section title="Payment" />
            <Row label="Amount" value={<span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 15 }}>{fmt(detailRecord.amount)}</span>} />
            <Row label="Method" value={detailRecord.method} />
            <Row label="Date" value={fmtDate(detailRecord.createdAt)} />

            <Section title="Customer" />
            <Row label="Name" value={detailRecord.customerName} />
            <Row label="Customer ID" value={detailRecord.customerId} />

            <Section title="Agent" />
            <Row label="Name" value={detailRecord.agentName} />
            <Row label="Agent ID" value={detailRecord.agentId} />
          </div>
        </div>
      )}
    </>
  )
}
