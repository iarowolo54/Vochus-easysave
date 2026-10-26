'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Transaction {
  id: string
  ref: string
  type: string
  amount: number
  method: string | null
  status: string
  createdAt: string
  customer: { name: string; customerId: string } | null
}

interface Stats {
  todaySavings: number; todaySavingsCount: number
  todayRedemptions: number; todayRedemptionsCount: number
  todayRepayments: number; todayRepaymentsCount: number
  totalVolume: number; totalCount: number
}

function txnIcon(type: string) {
  const m: Record<string, string> = { saving: '💰', redemption: '🎯', repayment: '🔄', disbursement: '💸', enrolment: '📋', loan: '🏦', wallet_funding: '💼' }
  return m[type] ?? '📊'
}
function txnLabel(type: string) {
  const m: Record<string, string> = { saving: 'Saving', redemption: 'Redemption', repayment: 'Repayment', disbursement: 'Disburse', enrolment: 'Enrolled', loan: 'Loan App', wallet_funding: 'Wallet Top-up' }
  return m[type] ?? type
}

const PAGE_SIZE = 20

export default function TransactionsPage() {
  const router = useRouter()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState('')
  const [date, setDate] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (type) params.set('type', type)
    if (date) params.set('date', date)
    params.set('page', String(page))
    params.set('limit', String(PAGE_SIZE))
    const res = await fetch(`/api/transactions?${params}`)
    const data = await res.json()
    setTransactions(data.transactions ?? [])
    setTotal(data.total ?? 0)
    setStats(data.stats ?? null)
    setLoading(false)
  }, [type, date, page])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="page-header">
        <h2>Transaction History</h2>
        <p>All savings, redemptions, loans and repayments</p>
      </div>

      <div className="grid g4" style={{ marginBottom: 18 }}>
        <div className="stat-card green">
          <div className="stat-icon" style={{ background: 'var(--gl)' }}>💰</div>
          <div className="stat-lbl">Today&apos;s Savings</div>
          <div className="stat-val">₦{(stats?.todaySavings ?? 0).toLocaleString()}</div>
          <div className="stat-sub">{stats?.todaySavingsCount ?? 0} transactions</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon" style={{ background: 'var(--bl)' }}>🎯</div>
          <div className="stat-lbl">Redemptions</div>
          <div className="stat-val">₦{(stats?.todayRedemptions ?? 0).toLocaleString()}</div>
          <div className="stat-sub">{stats?.todayRedemptionsCount ?? 0} transactions</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-icon" style={{ background: 'var(--pul)' }}>🔄</div>
          <div className="stat-lbl">Repayments</div>
          <div className="stat-val">₦{(stats?.todayRepayments ?? 0).toLocaleString()}</div>
          <div className="stat-sub">{stats?.todayRepaymentsCount ?? 0} transactions</div>
        </div>
        <div className="stat-card gold">
          <div className="stat-icon" style={{ background: 'var(--gdl)' }}>📊</div>
          <div className="stat-lbl">Total Volume</div>
          <div className="stat-val">₦{(stats?.totalVolume ?? 0).toLocaleString()}</div>
          <div className="stat-sub">{stats?.totalCount ?? 0} transactions</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18, padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <select className="finput" style={{ width: 150 }} value={type} onChange={e => { setType(e.target.value); setPage(1) }}>
            <option value="">All Types</option>
            <option value="saving">Saving</option>
            <option value="redemption">Redemption</option>
            <option value="loan">Loan</option>
            <option value="repayment">Repayment</option>
            <option value="enrolment">Enrolment</option>
            <option value="disbursement">Disbursement</option>
            <option value="wallet_funding">Wallet Funding</option>
          </select>
          <input className="finput" type="date" style={{ width: 150 }} value={date} onChange={e => { setDate(e.target.value); setPage(1) }} />
          <button className="btn btn-out btn-sm" onClick={() => { setType(''); setDate(''); setPage(1) }}>Clear</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Ref</th><th>Customer</th><th>Type</th><th>Amount</th><th>Date / Time</th><th>Method</th><th>Status</th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--mu)' }}>Loading…</td></tr>}
              {!loading && transactions.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--mu)' }}>No transactions found</td></tr>}
              {!loading && transactions.map(t => (
                <tr key={t.id} className="tr-link" onClick={() => router.push(`/dashboard/transactions/${t.id}`)}>
                  <td className="td-mono" style={{ color: 'var(--b)' }}>{t.ref}</td>
                  <td>
                    {t.customer
                      ? <><div className="td-name">{t.customer.name}</div><div className="td-sub">{t.customer.customerId}</div></>
                      : <div className="td-name">—</div>}
                  </td>
                  <td>{txnIcon(t.type)} {txnLabel(t.type)}</td>
                  <td className="td-mono" style={{
                    color: t.type === 'saving' ? 'var(--g)' : t.type === 'redemption' ? 'var(--rd)' : t.type === 'disbursement' ? 'var(--b)' : 'var(--b)'
                  }}>
                    {t.type === 'enrolment' ? 'New' : `${t.type === 'saving' ? '+' : t.type === 'redemption' ? '−' : ''}₦${t.amount.toLocaleString()}`}
                  </td>
                  <td>{new Date(t.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{t.method ?? '—'}</td>
                  <td><span className={`bdg ${t.status === 'Done' ? 'bdg-ok' : t.status === 'Pending' ? 'bdg-gd' : 'bdg-b'}`}>{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > PAGE_SIZE && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: '1px solid var(--br)', fontSize: 12.5, color: 'var(--mu)' }}>
            <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-out btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <button className="btn btn-out btn-sm" disabled={page >= Math.ceil(total / PAGE_SIZE)} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
