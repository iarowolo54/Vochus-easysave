'use client'

import { useState, useEffect, useCallback } from 'react'

interface DisbursedLoan {
  id: string
  ref: string
  principal: number
  totalAmount: number
  interestRate: number
  durationDays: number
  dueDate: string
  customerName: string
  customerId: string
  agentName: string
  agentId: string
  createdAt: string
  approvedBy: string | null
  outstanding: number
  isOverdue: boolean
}

const TABS = ['All Disbursed', 'Overdue']

export default function LoanDisbursePage() {
  const [loans, setLoans] = useState<DisbursedLoan[]>([])
  const [stats, setStats] = useState({ totalDisbursed: 0, totalDisbursedAmount: 0, totalOutstanding: 0, overdueCount: 0 })
  const [tab, setTab] = useState('All Disbursed')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [detailRecord, setDetailRecord] = useState<DisbursedLoan | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/loan-disbursements')
    const d = res.ok ? await res.json() : {}
    setLoans(d.loans ?? [])
    setStats({
      totalDisbursed: d.totalDisbursed ?? 0,
      totalDisbursedAmount: d.totalDisbursedAmount ?? 0,
      totalOutstanding: d.totalOutstanding ?? 0,
      overdueCount: d.overdueCount ?? 0,
    })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = tab === 'Overdue' ? loans.filter(l => l.isOverdue) : loans
  const PAGE_SIZE = 25
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const fmt = (n: number) => `₦${n.toLocaleString()}`
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  function dueBadge(loan: DisbursedLoan) {
    if (loan.outstanding <= 0) return <span className="bdg bdg-g">Settled</span>
    if (loan.isOverdue) return <span className="bdg bdg-r">Overdue</span>
    const diff = Math.floor((new Date(loan.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (diff <= 7) return <span className="bdg bdg-a">Due Soon</span>
    return <span className="bdg bdg-b">Active</span>
  }

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
          <h1>Loan Disbursements</h1>
          <p>All disbursed loans across agents</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat">
          <span className="stat-ic">📊</span>
          <div className="stat-lbl">Total Disbursed</div>
          <div className="stat-val blue">{stats.totalDisbursed.toLocaleString()}</div>
          <div className="stat-sub">Loans disbursed</div>
        </div>
        <div className="stat">
          <span className="stat-ic">💵</span>
          <div className="stat-lbl">Portfolio Value</div>
          <div className="stat-val green">{fmt(stats.totalDisbursedAmount)}</div>
          <div className="stat-sub">Total principal</div>
        </div>
        <div className="stat">
          <span className="stat-ic">⏳</span>
          <div className="stat-lbl">Outstanding</div>
          <div className="stat-val amber">{fmt(stats.totalOutstanding)}</div>
          <div className="stat-sub">Unpaid balance</div>
        </div>
        <div className="stat">
          <span className="stat-ic">🚨</span>
          <div className="stat-lbl">Overdue</div>
          <div className="stat-val red">{stats.overdueCount}</div>
          <div className="stat-sub">Past due date</div>
        </div>
      </div>

      <div className="card">
        <div className="tab-bar">
          {TABS.map(t => (
            <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t}
              {t === 'Overdue' && stats.overdueCount > 0 && <span className="bdg bdg-r" style={{ marginLeft: 6 }}>{stats.overdueCount}</span>}
            </button>
          ))}
        </div>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Ref</th>
                <th>Customer</th>
                <th>Agent</th>
                <th>Principal</th>
                <th>Total Due</th>
                <th>Rate</th>
                <th>Due Date</th>
                <th>Outstanding</th>
                <th>Approved By</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No loans found</td></tr>}
              {!loading && paginated.map(l => (
                <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => setDetailRecord(l)}>
                  <td><strong style={{ fontSize: 12, color: 'var(--blue)' }}>{l.ref}</strong></td>
                  <td>
                    <div className="td-av">
                      <div className="av av-purple">{l.customerName.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
                      <div>
                        <div className="td-name">{l.customerName}</div>
                        <div className="td-sub">{l.customerId}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="td-name">{l.agentName}</div>
                    <div className="td-sub">{l.agentId}</div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{fmt(l.principal)}</td>
                  <td style={{ fontWeight: 600, color: 'var(--red)' }}>{fmt(l.totalAmount)}</td>
                  <td style={{ color: 'var(--text2)' }}>{l.interestRate}%</td>
                  <td>
                    <span style={{ fontSize: 12, color: l.isOverdue ? 'var(--red)' : 'var(--text3)' }}>{fmtDate(l.dueDate)}</span>
                  </td>
                  <td style={{ fontWeight: 700, color: l.outstanding > 0 ? 'var(--amber)' : 'var(--green)' }}>{fmt(l.outstanding)}</td>
                  <td style={{ color: 'var(--text2)', fontSize: 12 }}>{l.approvedBy ?? '—'}</td>
                  <td>{dueBadge(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</div>
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
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--blue)', fontFamily: 'monospace' }}>{detailRecord.ref}</div>
                <div style={{ marginTop: 6 }}>{dueBadge(detailRecord)}</div>
              </div>
              <button className="btn btn-outline btn-xs" onClick={() => setDetailRecord(null)}>✕</button>
            </div>

            <Section title="Customer & Agent" />
            <Row label="Customer" value={detailRecord.customerName} />
            <Row label="Customer ID" value={detailRecord.customerId} />
            <Row label="Agent" value={detailRecord.agentName} />
            <Row label="Agent ID" value={detailRecord.agentId} />

            <Section title="Loan Details" />
            <Row label="Principal" value={<span style={{ color: 'var(--green)', fontWeight: 700 }}>{fmt(detailRecord.principal)}</span>} />
            <Row label="Interest Rate" value={`${detailRecord.interestRate}%`} />
            <Row label="Total Due" value={<span style={{ color: 'var(--red)', fontWeight: 700 }}>{fmt(detailRecord.totalAmount)}</span>} />
            <Row label="Duration" value={`${detailRecord.durationDays} days`} />
            <Row label="Outstanding" value={<span style={{ color: detailRecord.outstanding > 0 ? 'var(--amber)' : 'var(--green)', fontWeight: 700 }}>{fmt(detailRecord.outstanding)}</span>} />

            <Section title="Dates & Decision" />
            <Row label="Disbursed" value={fmtDate(detailRecord.createdAt)} />
            <Row label="Due Date" value={<span style={{ color: detailRecord.isOverdue ? 'var(--red)' : 'var(--text)' }}>{fmtDate(detailRecord.dueDate)}</span>} />
            <Row label="Approved By" value={detailRecord.approvedBy} />
          </div>
        </div>
      )}
    </>
  )
}
