'use client'

import { useState, useEffect, useCallback } from 'react'
import { Icons, type IconName } from '@/components/ui/icons'
import {
  Avatar, Empty, LoadError, PageHeader, SearchField, Segmented, TableSkeleton, naira, shortDate,
} from '../_components/admin-ui'

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

interface PlatformData {
  wallets: PlatformWallet[]
  totalAgentFloat: number
  totalAgentCommission: number
  totalCustomerSavings: number
  today: Today
}

interface AgentsData {
  agents: AgentWallet[]
  totalWalletBalance: number
  lowBalanceCount: number
}

type View = 'platform' | 'agents'

const EMPTY_TODAY: Today = { savings: 0, redemptions: 0, registrations: 0, walletFunding: 0, disbursements: 0, repayments: 0 }
const LOW_BALANCE = 10000 // same threshold the wallets API uses for lowBalanceCount
// Display-only estimate of today's platform fee. Mirrors the 1.6% default platform savings rate in
// wallet-rates.ts; the real figure depends on each plan's cadence and deposit method.
const EST_PLATFORM_RATE = 0.016

const WALLET_META: Record<string, { icon: IconName; label: string; desc: string }> = {
  Capital:     { icon: 'treasury', label: 'Capital reserve',    desc: 'Operating capital put into the platform' },
  Float:       { icon: 'cash',     label: 'Agent float pool',   desc: 'Pooled agent wallet balances' },
  SavingsPool: { icon: 'plan',     label: 'Savings pool',       desc: 'Customer savings held in trust' },
  Redemption:  { icon: 'redeem',   label: 'Redemption reserve', desc: 'Set aside for pending redemptions' },
  Revenue:     { icon: 'reports',  label: 'Revenue',            desc: 'Platform fees and interest earned' },
}

export default function WalletAccountsPage() {
  const [platform, setPlatform] = useState<PlatformData | null>(null)
  const [agentsData, setAgentsData] = useState<AgentsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [platformFailed, setPlatformFailed] = useState(false)
  const [agentsFailed, setAgentsFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>('platform')

  const load = useCallback(async () => {
    setLoading(true); setPlatformFailed(false); setAgentsFailed(false)
    const [platRes, agentRes] = await Promise.all([
      fetch('/api/admin/wallets/platform').catch(() => null),
      fetch('/api/admin/wallets').catch(() => null),
    ])
    try {
      if (!platRes?.ok) throw new Error()
      const plat = await platRes.json() as Partial<PlatformData>
      setPlatform({
        wallets: plat.wallets ?? [],
        totalAgentFloat: plat.totalAgentFloat ?? 0,
        totalAgentCommission: plat.totalAgentCommission ?? 0,
        totalCustomerSavings: plat.totalCustomerSavings ?? 0,
        today: plat.today ?? EMPTY_TODAY,
      })
    } catch {
      setPlatformFailed(true)
    }
    try {
      if (!agentRes?.ok) throw new Error()
      const agent = await agentRes.json() as Partial<AgentsData>
      setAgentsData({
        agents: agent.agents ?? [],
        totalWalletBalance: agent.totalWalletBalance ?? 0,
        lowBalanceCount: agent.lowBalanceCount ?? 0,
      })
    } catch {
      setAgentsFailed(true)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const today = platform?.today ?? EMPTY_TODAY
  const totalPlatform = (platform?.wallets ?? []).reduce((s, w) => s + w.balance, 0)
  const totalAll = platform ? totalPlatform + platform.totalAgentFloat + platform.totalAgentCommission : 0
  const net = platform ? platform.totalAgentFloat - platform.totalCustomerSavings : 0

  const term = search.trim().toLowerCase()
  const agents = agentsData?.agents ?? []
  const filteredAgents = agents.filter(a => !term ||
    a.name.toLowerCase().includes(term) || a.agentId.toLowerCase().includes(term) || (a.location ?? '').toLowerCase().includes(term))

  const statVal = (v: string) => loading && !platform ? <span className="skel stat-val cm-stat-skel" aria-hidden="true" /> : <div className="stat-val">{platform ? v : '—'}</div>

  function chipsFor(type: string) {
    switch (type) {
      case 'SavingsPool': return [`+${naira(today.savings)} saved today`, `−${naira(today.redemptions)} redeemed today`]
      case 'Revenue': return [`About +${naira(today.savings * EST_PLATFORM_RATE)} today (estimate)`]
      case 'Float': return [`+${naira(today.walletFunding)} funded today`]
      case 'Capital': return ['Operating reserve']
      case 'Redemption': return [`−${naira(today.redemptions)} today`]
      default: return []
    }
  }

  return (
    <>
      <PageHeader
        title="Wallet accounts"
        sub="Platform wallets and every agent’s wallet balance."
        actions={<button type="button" className="btn btn-outline" onClick={load} disabled={loading}>
          <Icons.retry size={16} aria-hidden="true" /> {loading ? 'Refreshing…' : 'Refresh'}
        </button>}
      />

      <div className="stats-grid">
        <div className="stat">
          <div className="stat-lbl">Total system funds</div>
          {statVal(naira(totalAll))}
          <div className="stat-sub">Platform wallets, agent wallets and commission</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Customer savings</div>
          {statVal(naira(platform?.totalCustomerSavings))}
          <div className="stat-sub">In active plans</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Agent float</div>
          {statVal(naira(platform?.totalAgentFloat))}
          <div className="stat-sub">
            {agentsData ? `${agentsData.lowBalanceCount} agent${agentsData.lowBalanceCount === 1 ? '' : 's'} under ${naira(LOW_BALANCE)}` : agentsFailed ? 'Low-balance count unavailable' : ' '}
          </div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Saved today</div>
          {statVal(naira(today.savings))}
          <div className="stat-sub">{platform ? `${naira(today.redemptions)} redeemed today` : ' '}</div>
        </div>
      </div>

      <div className="toolbar">
        <Segmented<View> label="Show wallets" value={view} onChange={setView} options={[
          { value: 'platform', label: 'Platform wallets' },
          { value: 'agents', label: 'Agent wallets', count: agentsData ? agents.length : undefined },
        ]} />
        {view === 'agents' && <SearchField value={search} onChange={setSearch} placeholder="Name, agent ID or location" label="Search agent wallets" />}
      </div>

      {view === 'platform' && (
        loading && !platform ? (
          <div className="cm-wallets is-3" aria-busy="true" aria-label="Loading">
            {[0, 1, 2].map(i => <span key={i} className="skel cm-wallet-skel" />)}
          </div>
        ) : platformFailed && !platform ? (
          <section className="card"><LoadError what="platform wallets" onRetry={load} /></section>
        ) : platform && (
          <>
            {platformFailed && <p className="a-alert a-alert-a cm-gap" role="status">We couldn’t refresh the platform wallets. These figures may be out of date.</p>}
            {platform.wallets.length === 0 ? (
              <section className="card cm-gap"><Empty icon="wallet" title="No platform wallets yet" text="Wallets are created the first time money moves into them, for example when capital is injected on the Treasury page." /></section>
            ) : (
              <div className="cm-wallets is-3">
                {platform.wallets.map(w => {
                  const meta = WALLET_META[w.type] ?? { icon: 'wallet' as IconName, label: w.type, desc: '' }
                  const Icon = Icons[meta.icon]
                  return (
                    <article key={w.id} className="cm-wallet">
                      <div className="cm-wallet-top"><span className="cm-wallet-ic" aria-hidden="true"><Icon size={20} /></span></div>
                      <h3 className="cm-wallet-lbl">{meta.label}</h3>
                      <div className="cm-wallet-val">{naira(w.balance)}</div>
                      {meta.desc && <p className="cm-wallet-desc">{meta.desc}</p>}
                      <div className="cm-chips">{chipsFor(w.type).map(c => <span key={c} className="cm-chip">{c}</span>)}</div>
                    </article>
                  )
                })}
              </div>
            )}

            <section className="card" aria-labelledby="solv-hd">
              <div className="card-hd"><h3 id="solv-hd">Solvency</h3></div>
              <div className="cm-solv">
                <div className="cm-solv-item">
                  <div className="cm-solv-lbl">Owed to customers</div>
                  <div className="cm-solv-val is-red">{naira(platform.totalCustomerSavings)}</div>
                  <div className="cm-solv-sub">Customer savings in active plans</div>
                </div>
                <div className="cm-solv-item">
                  <div className="cm-solv-lbl">Agent float backing it</div>
                  <div className={`cm-solv-val${platform.totalAgentFloat >= platform.totalCustomerSavings ? '' : ' is-amber'}`}>{naira(platform.totalAgentFloat)}</div>
                  <div className="cm-solv-sub">Total in agent wallets</div>
                </div>
                <div className="cm-solv-item">
                  <div className="cm-solv-lbl">Net position</div>
                  <div className={`cm-solv-val${net >= 0 ? '' : ' is-red'}`}>{net >= 0 ? '' : '−'}{naira(Math.abs(net))}</div>
                  <div className="cm-solv-sub">{net >= 0 ? 'Surplus: float covers what’s owed' : 'Deficit: float is short of what’s owed'}</div>
                </div>
              </div>
            </section>
          </>
        )
      )}

      {view === 'agents' && (
        <section className="card" aria-label="Agent wallet balances">
          {loading && !agentsData ? <TableSkeleton rows={8} cols={6} />
            : agentsFailed && !agentsData ? <LoadError what="agent wallets" onRetry={load} />
            : filteredAgents.length === 0 ? (
              term ? <Empty icon="search" title={`No agents match “${search.trim()}”`} text="Check the spelling, or search by agent ID or location." />
                : <Empty icon="customers" title="No agents yet" text="Agent wallets show here once agents are added." />
            ) : (
              <>
                {agentsFailed && <p className="a-alert a-alert-a cm-gap" role="status">We couldn’t refresh agent wallets. These figures may be out of date.</p>}
                <div className="tbl-wrap tbl-stack">
                  <table>
                    <thead>
                      <tr>
                        <th>Agent</th><th>Location</th><th className="num">Wallet</th><th className="num">Commission</th>
                        <th className="num">Funded today</th><th>Last funded</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAgents.map(a => {
                        const isLow = a.walletBalance < LOW_BALANCE
                        return (
                          <tr key={a.id}>
                            <td>
                              <div className="td-av">
                                <Avatar name={a.name} photoUrl={a.photoUrl} tone={isLow ? 'red' : 'blue'} />
                                <div><div className="td-name">{a.name}</div><div className="td-sub">{a.agentId}</div></div>
                              </div>
                            </td>
                            <td data-label="Location" className="cm-sub2">{a.location || '—'}</td>
                            <td className={`num cm-strong${isLow ? ' cm-neg' : ''}`} data-label="Wallet">{naira(a.walletBalance)}</td>
                            <td className="num" data-label="Commission">{naira(a.commissionBalance)}</td>
                            <td className="num" data-label="Funded today">{a.todayActivity > 0 ? naira(a.todayActivity) : <span className="cm-muted">—</span>}</td>
                            <td data-label="Last funded" className="cm-nowrap cm-sub2">{a.lastFunded ? shortDate(a.lastFunded) : '—'}</td>
                            <td data-label="Status">
                              <span className="cm-badges">
                                <span className={`bdg ${a.status === 'Active' ? 'bdg-g' : a.status === 'Suspended' ? 'bdg-r' : 'bdg-grey'}`}>{a.status}</span>
                                {isLow && <span className="bdg bdg-a">Low balance</span>}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="cm-foot">Low balance means under {naira(LOW_BALANCE)}. {agentsData && `${naira(agentsData.totalWalletBalance)} across all agent wallets.`}</p>
              </>
            )}
        </section>
      )}
    </>
  )
}
