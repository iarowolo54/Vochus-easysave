'use client'

import { useState, useEffect, useCallback } from 'react'

interface Stats {
  totalAgents: number
  totalCustomers: number
  totalSavingsPool: number
  activeLoans: number
  activeLoansPortfolio: number
  pendingLoans: number
  pendingRedemptions: number
}

interface Transaction {
  id: string
  ref: string
  type: string
  amount: number
  createdAt: string
  customerName: string | null
  agentName: string
}

interface Loan {
  id: string
  ref: string
  principal: number
  customerName: string
  agentName: string
  status: string
  createdAt: string
}

interface Agent {
  id: string
  agentId: string
  name: string
  location: string
  customerCount: number
  walletBalance: number
  commission: number
  status: string
  photoUrl?: string | null
}

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [pendingLoans, setPendingLoans] = useState<Loan[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    const [sRes, tRes, lRes, aRes] = await Promise.all([
      fetch('/api/admin/stats'),
      fetch('/api/admin/transactions'),
      fetch('/api/admin/loans?status=Pending'),
      fetch('/api/admin/agents'),
    ])
    const [s, t, l, a] = await Promise.all([
      sRes.ok ? sRes.json() : null,
      tRes.ok ? tRes.json() : null,
      lRes.ok ? lRes.json() : null,
      aRes.ok ? aRes.json() : null,
    ])
    if (s) setStats(s)
    setTransactions((t?.transactions ?? []).slice(0, 10))
    setPendingLoans((l?.loans ?? []).slice(0, 5))
    setAgents((a?.agents ?? []).slice(0, 5))
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  async function handleLoan(id: string, action: 'approve' | 'reject') {
    const res = await fetch(`/api/admin/loans/${id}/${action}`, { method: 'PATCH' })
    if (res.ok) {
      setToast(action === 'approve' ? 'Loan approved successfully' : 'Loan rejected')
      loadData()
      setTimeout(() => setToast(''), 4000)
    }
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }
  void showToast

  const fmt = (n: number) => `₦${n.toLocaleString()}`

  const typeLabel: Record<string, string> = {
    saving: 'Saving',
    redemption: 'Redemption',
    disbursement: 'Disbursement',
    repayment: 'Repayment',
    enrolment: 'Enrolment',
  }

  const dotColor: Record<string, string> = {
    saving: 'var(--green)',
    redemption: 'var(--blue)',
    disbursement: 'var(--amber)',
    repayment: 'var(--purple)',
    enrolment: 'var(--teal)',
  }

  if (loading) return <div style={{ padding: 40, color: 'var(--text3)', textAlign: 'center' }}>Loading dashboard…</div>

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>Platform Overview</h1>
          <p>Real-time snapshot of Vochus Easy Save operations</p>
        </div>
      </div>

      {stats && (
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div className="stat">
            <span className="stat-ic">🤝</span>
            <div className="stat-lbl">Total Agents</div>
            <div className="stat-val blue">{stats.totalAgents}</div>
            <div className="stat-sub">Registered agents</div>
          </div>
          <div className="stat">
            <span className="stat-ic">👥</span>
            <div className="stat-lbl">Total Customers</div>
            <div className="stat-val green">{stats.totalCustomers}</div>
            <div className="stat-sub">Enrolled customers</div>
          </div>
          <div className="stat">
            <span className="stat-ic">💰</span>
            <div className="stat-lbl">Total Savings Pool</div>
            <div className="stat-val teal">{fmt(stats.totalSavingsPool)}</div>
            <div className="stat-sub">Across all plans</div>
          </div>
          <div className="stat">
            <span className="stat-ic">💸</span>
            <div className="stat-lbl">Active Loans</div>
            <div className="stat-val amber">{stats.activeLoans}</div>
            <div className="stat-sub">{fmt(stats.activeLoansPortfolio)} portfolio</div>
          </div>
          <div className="stat">
            <span className="stat-ic">⏳</span>
            <div className="stat-lbl">Pending Approvals</div>
            <div className="stat-val red">{stats.pendingLoans}</div>
            <div className="stat-sub">Loans awaiting review</div>
          </div>
          <div className="stat">
            <span className="stat-ic">🎯</span>
            <div className="stat-lbl">Pending Redemptions</div>
            <div className="stat-val purple">{stats.pendingRedemptions}</div>
            <div className="stat-sub">Awaiting processing</div>
          </div>
        </div>
      )}

      <div className="g65" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card-hd">
            <h3>Live Activity Feed</h3>
            <span className="bdg bdg-g">Last 10</span>
          </div>
          {transactions.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 16 }}>No transactions</div>}
          {transactions.map(t => (
            <div key={t.id} className="feed-item">
              <div className="feed-dot" style={{ background: dotColor[t.type] ?? 'var(--text3)' }} />
              <div className="feed-body">
                <strong>{typeLabel[t.type] ?? t.type}</strong> — {t.customerName ?? 'N/A'} · {t.ref}
                <div className="feed-time">{t.agentName} · {new Date(t.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              {t.amount > 0 && (
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', whiteSpace: 'nowrap' }}>{fmt(t.amount)}</div>
              )}
            </div>
          ))}
        </div>

        <div>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-hd">
              <h3>Pending Loan Approvals</h3>
              {stats && stats.pendingLoans > 0 && <span className="bdg bdg-a">{stats.pendingLoans} pending</span>}
            </div>
            {pendingLoans.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 16 }}>No pending loans</div>}
            {pendingLoans.map(l => (
              <div key={l.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{l.customerName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{l.ref} · {l.agentName}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>{fmt(l.principal)}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button className="btn btn-green btn-xs" onClick={() => handleLoan(l.id, 'approve')}>Approve</button>
                  <button className="btn btn-danger btn-xs" onClick={() => handleLoan(l.id, 'reject')}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <h3>Top Agents</h3>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Location</th>
                <th>Customers</th>
                <th>Wallet Balance</th>
                <th>Commission</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {agents.map(a => (
                <tr key={a.id}>
                  <td>
                    <div className="td-av">
                      <div className="av av-green" style={{ overflow: 'hidden', padding: 0 }}>{a.photoUrl ? <img src={a.photoUrl} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : a.name.split(' ').map(w => w[0]).join('').slice(0,2)}</div>
                      <div>
                        <div className="td-name">{a.name}</div>
                        <div className="td-sub">{a.agentId}</div>
                      </div>
                    </div>
                  </td>
                  <td>{a.location}</td>
                  <td>{a.customerCount}</td>
                  <td>{fmt(a.walletBalance)}</td>
                  <td>{fmt(a.commission)}</td>
                  <td>
                    <span className={`bdg ${a.status === 'Active' ? 'bdg-g' : a.status === 'Suspended' ? 'bdg-r' : 'bdg-a'}`}>{a.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`a-toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  )
}
