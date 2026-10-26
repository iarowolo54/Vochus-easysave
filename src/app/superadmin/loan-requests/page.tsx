'use client'

import { useState, useEffect, useCallback } from 'react'

interface Loan {
  id: string
  ref: string
  principal: number
  interestRate: number
  totalAmount: number
  durationDays: number
  dueDate: string
  status: string
  approvedBy: string | null
  createdAt: string
  customerName: string
  customerId: string
  agentName: string
  agentId: string
}

const TABS = ['All', 'Pending', 'Approved', 'Rejected', 'Disbursed']

const PAGE_SIZE = 25

export default function LoanRequestsPage() {
  const [loans, setLoans] = useState<Loan[]>([])
  const [activeTab, setActiveTab] = useState('All')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [toastColor, setToastColor] = useState('')
  const [detailRecord, setDetailRecord] = useState<Loan | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const q = activeTab !== 'All' ? `?status=${activeTab}` : ''
    const res = await fetch(`/api/admin/loans${q}`)
    const d = res.ok ? await res.json() : {}
    setLoans(d.loans ?? [])
    setPage(1)
    setLoading(false)
  }, [activeTab])

  useEffect(() => { load() }, [load])

  async function handleAction(id: string, action: 'approve' | 'reject') {
    const res = await fetch(`/api/admin/loans/${id}/${action}`, { method: 'PATCH' })
    if (res.ok) {
      const msg = action === 'approve' ? 'Loan approved successfully' : 'Loan rejected'
      setToast(msg)
      setToastColor(action === 'approve' ? 'var(--green)' : 'var(--red)')
      setDetailRecord(null)
      load()
      setTimeout(() => setToast(''), 4000)
    }
  }

  const fmt = (n: number) => `₦${n.toLocaleString()}`
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  const statusClass: Record<string, string> = {
    Pending: 'bdg-a',
    Approved: 'bdg-g',
    Rejected: 'bdg-r',
    Disbursed: 'bdg-b',
    Repaid: 'bdg-p',
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
          <h1>Loan Requests</h1>
          <p>Review and approve loan applications from agents</p>
        </div>
      </div>

      <div className="card">
        <div className="tab-bar">
          {TABS.map(tab => (
            <button
              key={tab}
              className={`tab${activeTab === tab ? ' active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
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
                <th>Amount</th>
                <th>Rate</th>
                <th>Duration</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td></tr>
              )}
              {!loading && loans.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No loans found</td></tr>
              )}
              {!loading && loans.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(l => (
                <tr key={l.id} style={{ cursor: 'pointer' }} onClick={e => { if ((e.target as HTMLElement).closest('button')) return; setDetailRecord(l) }}>
                  <td><strong style={{ color: 'var(--blue)', fontSize: 12 }}>{l.ref}</strong></td>
                  <td>
                    <div className="td-name">{l.customerName}</div>
                    <div className="td-sub">{l.customerId}</div>
                  </td>
                  <td>
                    <div className="td-name">{l.agentName}</div>
                    <div className="td-sub">{l.agentId}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 700, color: 'var(--green)' }}>{fmt(l.principal)}</div>
                    <div className="td-sub">Total: {fmt(l.totalAmount)}</div>
                  </td>
                  <td>{l.interestRate}%</td>
                  <td>{l.durationDays}d</td>
                  <td>{fmtDate(l.dueDate)}</td>
                  <td>
                    <span className={`bdg ${statusClass[l.status] ?? 'bdg-grey'}`}>{l.status}</span>
                    {l.approvedBy && <div className="td-sub">by {l.approvedBy}</div>}
                  </td>
                  <td>
                    {l.status === 'Pending' ? (
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button className="btn btn-green btn-xs" onClick={() => handleAction(l.id, 'approve')}>Approve</button>
                        <button className="btn btn-danger btn-xs" onClick={() => handleAction(l.id, 'reject')}>Reject</button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        {!loading && Math.ceil(loans.length / PAGE_SIZE) > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, loans.length)} of {loans.length}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn btn-xs btn-outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 80, textAlign: 'center' }}>Page {page} of {Math.ceil(loans.length / PAGE_SIZE)}</span>
              <button className="btn btn-xs btn-outline" disabled={page === Math.ceil(loans.length / PAGE_SIZE)} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        )}
        </div>
      </div>

      <div className={`a-toast${toast ? ' show' : ''}`} style={{ background: toastColor || '#071a0e' }}>{toast}</div>

      {detailRecord && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }} onClick={() => setDetailRecord(null)}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,.45)' }} />
          <div style={{ width: 420, background: 'var(--surface)', height: '100%', overflowY: 'auto', padding: 28, boxShadow: '-8px 0 40px rgba(0,0,0,.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--blue)', fontFamily: 'monospace' }}>{detailRecord.ref}</div>
                <div style={{ marginTop: 6 }}>
                  <span className={`bdg ${statusClass[detailRecord.status] ?? 'bdg-grey'}`}>{detailRecord.status}</span>
                </div>
              </div>
              <button className="btn btn-outline btn-xs" onClick={() => setDetailRecord(null)}>✕</button>
            </div>

            <Section title="Customer & Agent" />
            <Row label="Customer" value={detailRecord.customerName} />
            <Row label="Customer ID" value={detailRecord.customerId} />
            <Row label="Agent" value={detailRecord.agentName} />
            <Row label="Agent ID" value={detailRecord.agentId} />

            <Section title="Loan Terms" />
            <Row label="Principal" value={<span style={{ color: 'var(--green)', fontWeight: 700 }}>{fmt(detailRecord.principal)}</span>} />
            <Row label="Interest Rate" value={`${detailRecord.interestRate}%`} />
            <Row label="Total Repayable" value={<span style={{ color: 'var(--red)', fontWeight: 700 }}>{fmt(detailRecord.totalAmount)}</span>} />
            <Row label="Duration" value={`${detailRecord.durationDays} days`} />
            <Row label="Due Date" value={fmtDate(detailRecord.dueDate)} />

            <Section title="Decision" />
            <Row label="Requested" value={fmtDate(detailRecord.createdAt)} />
            <Row label="Approved By" value={detailRecord.approvedBy} />

            {detailRecord.status === 'Pending' && (
              <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
                <button className="btn btn-green" style={{ flex: 1 }} onClick={() => handleAction(detailRecord.id, 'approve')}>✅ Approve</button>
                <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => handleAction(detailRecord.id, 'reject')}>Reject</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
