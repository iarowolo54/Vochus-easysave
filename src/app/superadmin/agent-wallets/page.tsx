'use client'

import { useState, useEffect, useCallback } from 'react'
import { blockMinus, nonNegativeString } from '@/lib/numeric'

interface AgentWallet {
  id: string
  agentId: string
  name: string
  location: string
  walletBalance: number
  commissionBalance: number
  floatLimit: number
  status: string
  todayActivity: number
  lastFunded: string | null
}

interface Stats {
  totalWalletBalance: number
  totalFundedToday: number
  lowBalanceCount: number
}

export default function AgentWalletsPage() {
  const [agents, setAgents] = useState<AgentWallet[]>([])
  const [stats, setStats] = useState<Stats>({ totalWalletBalance: 0, totalFundedToday: 0, lowBalanceCount: 0 })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  const [showFundModal, setShowFundModal] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [fundAmount, setFundAmount] = useState('')
  const [funding, setFunding] = useState(false)

  const [payingOut, setPayingOut] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/wallets')
    const d = res.ok ? await res.json() : {}
    setAgents(d.agents ?? [])
    setStats({
      totalWalletBalance: d.totalWalletBalance ?? 0,
      totalFundedToday: d.totalFundedToday ?? 0,
      lowBalanceCount: d.lowBalanceCount ?? 0,
    })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = agents.filter(a =>
    !search ||
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.agentId.toLowerCase().includes(search.toLowerCase()) ||
    a.location.toLowerCase().includes(search.toLowerCase())
  )
  const PAGE_SIZE = 25
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  async function handleFund() {
    if (!selectedAgentId || !fundAmount || parseFloat(fundAmount) <= 0) return
    setFunding(true)
    const res = await fetch('/api/admin/wallets/fund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: selectedAgentId, amount: parseFloat(fundAmount) }),
    })
    setFunding(false)
    if (res.ok) {
      setShowFundModal(false)
      setSelectedAgentId('')
      setFundAmount('')
      showToast('Wallet funded successfully')
      load()
    } else {
      const d = res.ok ? await res.json() : {}
      showToast((d as { error?: string }).error ?? 'Failed to fund wallet')
    }
  }

  async function handleCommissionPayout(agentId: string) {
    setPayingOut(agentId)
    const res = await fetch('/api/admin/wallets/commission-payout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    })
    setPayingOut(null)
    if (res.ok) {
      showToast('Commission paid out successfully')
      load()
    } else {
      const d = res.ok ? await res.json() : {}
      showToast((d as { error?: string }).error ?? 'Payout failed')
    }
  }

  const fmt = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 0 })}`
  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>Agent Wallets</h1>
          <p>Monitor balances, fund allocation and transactions per agent</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => { setSelectedAgentId(''); setFundAmount(''); setShowFundModal(true) }}
        >
          ＋ Fund Agent Wallet
        </button>
      </div>

      {/* Stat Cards */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 24 }}>
        <div className="stat">
          <span className="stat-ic">💼</span>
          <div className="stat-lbl">Total Wallet Balance</div>
          <div className="stat-val blue">{fmt(stats.totalWalletBalance)}</div>
          <div className="stat-sub">Across all agent wallets</div>
        </div>
        <div className="stat">
          <span className="stat-ic">💸</span>
          <div className="stat-lbl">Allocated Today</div>
          <div className="stat-val green">{fmt(stats.totalFundedToday)}</div>
          <div className="stat-sub">Wallet top-ups today</div>
        </div>
        <div className="stat">
          <span className="stat-ic">⚠️</span>
          <div className="stat-lbl">Low Balance Alerts</div>
          <div className="stat-val" style={{ color: 'var(--amber)' }}>{stats.lowBalanceCount}</div>
          <div className="stat-sub">Agents below ₦10,000</div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div style={{ marginBottom: 16 }}>
          <div className="a-topbar-search" style={{ maxWidth: 320 }}>
            <span style={{ color: 'var(--text3)' }}>🔍</span>
            <input
              type="text"
              placeholder="Search agents…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Wallet Balance</th>
                <th>Float Limit</th>
                <th>Commission Balance</th>
                <th>Last Funded</th>
                <th>Today&apos;s Activity</th>
                <th>Alert</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No agents found</td>
                </tr>
              )}
              {!loading && paginated.map(a => {
                const isLow = a.walletBalance < 10000
                return (
                  <tr key={a.id}>
                    <td>
                      <div className="td-av">
                        <div className={`av ${isLow ? 'av-amber' : 'av-green'}`}>
                          {a.name.split(' ').map((word: string) => word[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <div className="td-name">{a.name}</div>
                          <div className="td-sub">{a.agentId}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{
                        fontFamily: "'IBM Plex Serif', serif",
                        fontSize: 15,
                        fontWeight: 800,
                        color: isLow ? 'var(--amber)' : 'var(--green)',
                      }}>
                        {fmt(a.walletBalance)}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text2)', fontSize: 13 }}>
                      {fmt(a.floatLimit ?? 0)}
                    </td>
                    <td>
                      <span style={{
                        fontWeight: 600,
                        fontSize: 13,
                        color: a.commissionBalance > 0 ? 'var(--teal)' : 'var(--text3)',
                      }}>
                        {fmt(a.commissionBalance)}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text3)', fontSize: 12 }}>{fmtDate(a.lastFunded)}</td>
                    <td>
                      {a.todayActivity > 0
                        ? <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: 13 }}>+{fmt(a.todayActivity)}</span>
                        : <span style={{ color: 'var(--text3)' }}>—</span>}
                    </td>
                    <td>
                      {isLow
                        ? <span className="bdg bdg-r">Low</span>
                        : <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className={`btn btn-xs ${isLow ? 'btn-amber' : 'btn-green'}`}
                          onClick={() => { setSelectedAgentId(a.id); setFundAmount(''); setShowFundModal(true) }}
                        >
                          {isLow ? 'Fund Now' : 'Fund'}
                        </button>
                        {a.commissionBalance > 0 && (
                          <button
                            className="btn btn-xs"
                            style={{ background: 'var(--teal)', color: '#fff' }}
                            disabled={payingOut === a.id}
                            onClick={() => handleCommissionPayout(a.id)}
                          >
                            {payingOut === a.id ? '…' : 'Payout'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
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

      {/* Fund Modal */}
      {showFundModal && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,.45)',
          zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--surface)',
            borderRadius: 'var(--r)',
            padding: 28,
            width: 400,
            boxShadow: '0 16px 48px rgba(0,0,0,.25)',
          }}>
            <h3 style={{ fontFamily: "'IBM Plex Serif', serif", fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
              Fund Agent Wallet
            </h3>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>
                Select Agent
              </label>
              <select
                value={selectedAgentId}
                onChange={e => setSelectedAgentId(e.target.value)}
                style={{
                  width: '100%', padding: '9px 12px', borderRadius: 8,
                  border: '1.5px solid var(--border)', fontSize: 13,
                  fontFamily: 'IBM Plex Sans, sans-serif',
                  background: 'var(--surface2)', color: 'var(--text)',
                }}
              >
                <option value="">— choose agent —</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.agentId})</option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>
                Amount (₦)
              </label>
              <input
                type="tel"
                inputMode="decimal"
                onKeyDown={blockMinus}
                placeholder="e.g. 50000"
                value={fundAmount}
                onChange={e => setFundAmount(nonNegativeString(e.target.value))}
                style={{
                  width: '100%', padding: '9px 12px', borderRadius: 8,
                  border: '1.5px solid var(--border)', fontSize: 13,
                  fontFamily: 'IBM Plex Sans, sans-serif',
                  background: 'var(--surface2)', color: 'var(--text)',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setShowFundModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleFund} disabled={funding}>
                {funding ? 'Processing…' : 'Confirm Fund'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`a-toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  )
}
