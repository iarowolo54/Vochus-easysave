'use client'

import { useState, useEffect, useCallback } from 'react'

interface Transaction {
  id: string
  ref: string
  type: string
  amount: number
  method: string | null
  status: string
  createdAt: string
  agentName: string
  agentId: string
  customerName: string | null
  customerId: string | null
}

const TYPES = ['', 'saving', 'redemption', 'disbursement', 'repayment', 'enrolment']
const TYPE_LABELS: Record<string, string> = {
  '': 'All Types',
  saving: 'Savings',
  redemption: 'Redemptions',
  disbursement: 'Disbursements',
  repayment: 'Repayments',
  enrolment: 'Enrolments',
}

const typeBadge: Record<string, string> = {
  saving: 'bdg-g',
  redemption: 'bdg-b',
  disbursement: 'bdg-a',
  repayment: 'bdg-p',
  enrolment: 'bdg-t',
}

const PAGE_SIZE = 25

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [type, setType] = useState('')
  const [date, setDate] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [detailRecord, setDetailRecord] = useState<Transaction | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (type) params.set('type', type)
    if (date) params.set('date', date)
    const q = params.toString() ? `?${params}` : ''
    const res = await fetch(`/api/admin/transactions${q}`)
    const d = res.ok ? await res.json() : {}
    setTransactions(d.transactions ?? [])
    setPage(1)
    setLoading(false)
  }, [type, date])

  useEffect(() => { load() }, [load])

  const fmt = (n: number) => `₦${n.toLocaleString()}`
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const paginated = transactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(transactions.length / PAGE_SIZE)

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
          <h1>Transaction History</h1>
          <p>All platform transactions across agents and customers</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={type}
            onChange={e => setType(e.target.value)}
            style={{ width: 'auto', minWidth: 160 }}
          >
            {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{ width: 'auto' }}
          />
          <button className="btn btn-outline btn-sm" onClick={() => { setType(''); setDate('') }}>Clear</button>
        </div>
      </div>

      <div className="card">
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>{transactions.length} transactions</div>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Ref</th>
                <th>Type</th>
                <th>Customer</th>
                <th>Agent</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td></tr>
              )}
              {!loading && transactions.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No transactions found</td></tr>
              )}
              {!loading && paginated.map(t => (
                <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setDetailRecord(t)}>
                  <td><strong style={{ fontSize: 12, color: 'var(--blue)' }}>{t.ref}</strong></td>
                  <td><span className={`bdg ${typeBadge[t.type] ?? 'bdg-grey'}`}>{TYPE_LABELS[t.type] ?? t.type}</span></td>
                  <td>
                    {t.customerName ? (
                      <>
                        <div className="td-name">{t.customerName}</div>
                        <div className="td-sub">{t.customerId}</div>
                      </>
                    ) : <span style={{ color: 'var(--text3)' }}>—</span>}
                  </td>
                  <td>
                    <div className="td-name">{t.agentName}</div>
                    <div className="td-sub">{t.agentId}</div>
                  </td>
                  <td style={{ fontWeight: t.amount > 0 ? 600 : 400, color: t.amount > 0 ? 'var(--green)' : 'var(--text3)' }}>
                    {t.amount > 0 ? fmt(t.amount) : '—'}
                  </td>
                  <td style={{ color: 'var(--text2)', fontSize: 12 }}>{t.method ?? '—'}</td>
                  <td style={{ color: 'var(--text3)', fontSize: 12 }}>
                    {fmtDate(t.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, transactions.length)} of {transactions.length}</div>
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
                <div style={{ marginTop: 6 }}>
                  <span className={`bdg ${typeBadge[detailRecord.type] ?? 'bdg-grey'}`}>{TYPE_LABELS[detailRecord.type] ?? detailRecord.type}</span>
                </div>
              </div>
              <button className="btn btn-outline btn-xs" onClick={() => setDetailRecord(null)}>✕</button>
            </div>

            <Section title="Transaction" />
            <Row label="Amount" value={detailRecord.amount > 0 ? <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 15 }}>{fmt(detailRecord.amount)}</span> : '—'} />
            <Row label="Method" value={detailRecord.method} />
            <Row label="Status" value={<span className={`bdg ${detailRecord.status === 'Done' ? 'bdg-g' : 'bdg-a'}`}>{detailRecord.status}</span>} />
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
