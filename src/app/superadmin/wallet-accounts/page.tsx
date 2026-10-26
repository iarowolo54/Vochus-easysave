'use client'

import { useState, useEffect, useCallback } from 'react'

interface PlatformWallet {
  id: string
  type: string
  balance: number
}

interface Today {
  savings: number
  redemptions: number
  registrations: number
  walletFunding: number
  disbursements: number
  repayments: number
}

interface AgentWallet {
  id: string
  agentId: string
  name: string
  location: string
  walletBalance: number
  commissionBalance: number
  status: string
  todayActivity: number
  lastFunded: string | null
  photoUrl?: string | null
}

interface PageData {
  wallets: PlatformWallet[]
  totalAgentFloat: number
  totalAgentCommission: number
  totalCustomerSavings: number
  today: Today
  agents: AgentWallet[]
  totalWalletBalance: number
  lowBalanceCount: number
}

const WALLET_META: Record<string, { icon: string; label: string; desc: string; color: string }> = {
  Capital:      { icon: '🏦', label: 'Capital Reserve',    desc: 'Initial operating capital',           color: 'var(--blue)'   },
  Float:        { icon: '💵', label: 'Agent Float Pool',   desc: 'Pooled agent wallet balances',         color: 'var(--green)'  },
  SavingsPool:  { icon: '🪙', label: 'Savings Pool',       desc: 'Customer savings held in trust',       color: 'var(--amber)'  },
  Redemption:   { icon: '🔄', label: 'Redemption Reserve', desc: 'Reserved for pending redemptions',     color: 'var(--purple)' },
  Revenue:      { icon: '📈', label: 'Revenue Wallet',     desc: 'Platform fees and interest earned',    color: 'var(--green)'  },
}

export default function WalletAccountsPage() {
  const [data, setData] = useState<PageData>({
    wallets: [], totalAgentFloat: 0, totalAgentCommission: 0, totalCustomerSavings: 0,
    today: { savings: 0, redemptions: 0, registrations: 0, walletFunding: 0, disbursements: 0, repayments: 0 },
    agents: [], totalWalletBalance: 0, lowBalanceCount: 0,
  })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'platform' | 'agents'>('platform')

  const load = useCallback(async () => {
    setLoading(true)
    const [platRes, agentRes] = await Promise.all([
      fetch('/api/admin/wallets/platform'),
      fetch('/api/admin/wallets'),
    ])
    const plat = platRes.ok ? await platRes.json() : {}
    const agent = agentRes.ok ? await agentRes.json() : {}
    setData({
      wallets: plat.wallets ?? [],
      totalAgentFloat: plat.totalAgentFloat ?? 0,
      totalAgentCommission: plat.totalAgentCommission ?? 0,
      totalCustomerSavings: plat.totalCustomerSavings ?? 0,
      today: plat.today ?? { savings: 0, redemptions: 0, registrations: 0, walletFunding: 0, disbursements: 0, repayments: 0 },
      agents: agent.agents ?? [],
      totalWalletBalance: agent.totalWalletBalance ?? 0,
      lowBalanceCount: agent.lowBalanceCount ?? 0,
    })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const fmt = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 0 })}`

  const totalPlatform = data.wallets.reduce((s, w) => s + w.balance, 0)
  const totalAll = totalPlatform + data.totalAgentFloat + data.totalAgentCommission

  const filteredAgents = data.agents.filter(a =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.agentId.toLowerCase().includes(search.toLowerCase()) ||
    a.location.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>Wallet Accounts</h1>
          <p>Platform treasury wallets and agent wallet balances</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 24 }}>
        <div className="stat">
          <span className="stat-ic">🏦</span>
          <div className="stat-lbl">Total System Funds</div>
          <div className="stat-val blue">{loading ? '…' : fmt(totalAll)}</div>
          <div className="stat-sub">Platform + Agent wallets</div>
        </div>
        <div className="stat">
          <span className="stat-ic">🪙</span>
          <div className="stat-lbl">Customer Savings</div>
          <div className="stat-val amber">{loading ? '…' : fmt(data.totalCustomerSavings)}</div>
          <div className="stat-sub">Active savings plans</div>
        </div>
        <div className="stat">
          <span className="stat-ic">💵</span>
          <div className="stat-lbl">Agent Float Total</div>
          <div className="stat-val green">{loading ? '…' : fmt(data.totalAgentFloat)}</div>
          <div className="stat-sub">{data.lowBalanceCount} agents low balance</div>
        </div>
        <div className="stat">
          <span className="stat-ic">📈</span>
          <div className="stat-lbl">Today Savings Volume</div>
          <div className="stat-val green">{loading ? '…' : fmt(data.today.savings)}</div>
          <div className="stat-sub">Redemptions: {fmt(data.today.redemptions)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['platform', 'agents'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`btn btn-sm ${activeTab === tab ? 'btn-green' : 'btn-outline'}`}>
            {tab === 'platform' ? '🏛️ Platform Wallets' : '👥 Agent Wallets'}
          </button>
        ))}
      </div>

      {activeTab === 'platform' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 24 }}>
            {data.wallets.map(w => {
              const meta = WALLET_META[w.type] ?? { icon: '💼', label: w.type, desc: '', color: 'var(--text)' }
              return (
                <div key={w.id} className="card" style={{ margin: 0, padding: 22 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: meta.color + '22', border: `1px solid ${meta.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{meta.icon}</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{meta.label}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{meta.desc}</div>
                    </div>
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 800, fontSize: 26, color: meta.color, marginBottom: 8 }}>
                    {loading ? '…' : fmt(w.balance)}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {w.type === 'SavingsPool' && (
                      <>
                        <span style={{ fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', color: 'var(--text3)' }}>+{fmt(data.today.savings)} today</span>
                        <span style={{ fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', color: 'var(--text3)' }}>-{fmt(data.today.redemptions)} redeemed</span>
                      </>
                    )}
                    {w.type === 'Revenue' && (
                      <span style={{ fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', color: 'var(--text3)' }}>+{fmt(Math.round(data.today.savings * 0.016))} today</span>
                    )}
                    {w.type === 'Float' && (
                      <span style={{ fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', color: 'var(--text3)' }}>+{fmt(data.today.walletFunding)} funded today</span>
                    )}
                    {w.type === 'Capital' && (
                      <span style={{ fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', color: 'var(--text3)' }}>Operating reserve</span>
                    )}
                    {w.type === 'Redemption' && (
                      <span style={{ fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', color: 'var(--text3)' }}>-{fmt(data.today.redemptions)} today</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div className="card-hd"><h3>Solvency Overview</h3></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: 16 }}>
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 6, fontWeight: 600 }}>TOTAL LIABILITIES</div>
                <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 800, fontSize: 22, color: 'var(--red)' }}>{loading ? '…' : fmt(data.totalCustomerSavings)}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 4 }}>Customer savings owed</div>
              </div>
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: 16 }}>
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 6, fontWeight: 600 }}>AGENT FLOAT COVERAGE</div>
                <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 800, fontSize: 22, color: data.totalAgentFloat >= data.totalCustomerSavings ? 'var(--green)' : 'var(--amber)' }}>{loading ? '…' : fmt(data.totalAgentFloat)}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 4 }}>Agent wallet backing</div>
              </div>
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: 16 }}>
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 6, fontWeight: 600 }}>NET POSITION</div>
                <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 800, fontSize: 22, color: (data.totalAgentFloat - data.totalCustomerSavings) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {loading ? '…' : fmt(Math.abs(data.totalAgentFloat - data.totalCustomerSavings))}
                  {!loading && <span style={{ fontSize: 12, fontFamily: 'IBM Plex Sans, sans-serif', marginLeft: 6 }}>{data.totalAgentFloat >= data.totalCustomerSavings ? 'surplus' : 'deficit'}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 4 }}>Float minus liabilities</div>
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 'agents' && (
        <div className="card">
          <div className="card-hd">
            <h3>Agent Wallet Balances</h3>
            <input
              type="text" placeholder="Search agents…" value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ padding: '7px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--text)', outline: 'none', width: 220 }}
            />
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th><th>Location</th><th>Wallet Balance</th><th>Commission</th><th>Today Activity</th><th>Last Funded</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td></tr>}
                {!loading && filteredAgents.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No agents found</td></tr>}
                {!loading && filteredAgents.map(a => {
                  const initials = a.name.split(' ').map(w => w[0]).join('').slice(0, 2)
                  const isLow = a.walletBalance < 10000
                  return (
                    <tr key={a.id}>
                      <td>
                        <div className="td-av">
                          <div className={`av av-${isLow ? 'red' : 'blue'}`} style={{ overflow: 'hidden', padding: 0 }}>{a.photoUrl ? <img src={a.photoUrl} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}</div>
                          <div><div className="td-name">{a.name}</div><div className="td-sub">{a.agentId}</div></div>
                        </div>
                      </td>
                      <td style={{ color: 'var(--text2)' }}>{a.location}</td>
                      <td style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, color: isLow ? 'var(--red)' : 'var(--green)' }}>{fmt(a.walletBalance)}</td>
                      <td style={{ color: 'var(--text2)' }}>{fmt(a.commissionBalance)}</td>
                      <td style={{ color: 'var(--text3)' }}>{a.todayActivity > 0 ? fmt(a.todayActivity) : '—'}</td>
                      <td style={{ color: 'var(--text3)', fontSize: 12 }}>{a.lastFunded ? new Date(a.lastFunded).toLocaleDateString('en-GB') : '—'}</td>
                      <td><span className={`bdg ${a.status === 'Active' ? 'bdg-g' : 'bdg-r'}`}>{a.status}</span>{isLow && <span className="bdg bdg-r" style={{ marginLeft: 4 }}>Low</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
