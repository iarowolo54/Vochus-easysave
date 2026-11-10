'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Avatar, Empty, LoadError, PageHeader, Pager, SearchField, Segmented,
  TableSkeleton, naira, shortDate,
} from '../_components/admin-ui'

interface AgentWallet {
  id: string
  agentId: string
  name: string
  location: string
  walletBalance: number
  commissionBalance: number
  floatLimit?: number | null
  status: string
  todayActivity: number
  lastFunded: string | null
  photoUrl?: string | null
}

interface Stats {
  totalWalletBalance: number
  totalFundedToday: number
  lowBalanceCount: number
}

type Filter = 'all' | 'low' | 'commission'

const PAGE_SIZE = 25
const LOW_BALANCE = 10000

export default function AgentWalletsPage() {
  const [agents, setAgents] = useState<AgentWallet[]>([])
  const [stats, setStats] = useState<Stats>({ totalWalletBalance: 0, totalFundedToday: 0, lowBalanceCount: 0 })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch('/api/admin/wallets')
      if (!res.ok) throw new Error()
      const d = await res.json() as Partial<Stats> & { agents?: AgentWallet[] }
      setAgents(d.agents ?? [])
      setStats({
        totalWalletBalance: d.totalWalletBalance ?? 0,
        totalFundedToday: d.totalFundedToday ?? 0,
        lowBalanceCount: d.lowBalanceCount ?? 0,
      })
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, filter])

  const q = search.trim().toLowerCase()
  const matches = agents.filter(a => !q || a.name.toLowerCase().includes(q) || a.agentId.toLowerCase().includes(q) || a.location.toLowerCase().includes(q))
  const counts = {
    all: matches.length,
    low: matches.filter(a => a.walletBalance < LOW_BALANCE).length,
    commission: matches.filter(a => a.commissionBalance > 0).length,
  }
  const filtered = matches.filter(a => filter === 'all' ? true : filter === 'low' ? a.walletBalance < LOW_BALANCE : a.commissionBalance > 0)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <>
      <PageHeader
        title="Agent wallets"
        sub="Agents’ cash balances, commission owed and today’s top-ups."
      />

      <div className="stats-grid am-stats-3">
        <div className="stat">
          <div className="stat-lbl">Total in agent wallets</div>
          <div className="stat-val">{loading && !agents.length ? '—' : naira(stats.totalWalletBalance)}</div>
          <div className="stat-sub">Across all agents</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Topped up today</div>
          <div className="stat-val">{loading && !agents.length ? '—' : naira(stats.totalFundedToday)}</div>
          <div className="stat-sub">Since midnight</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Low balance</div>
          <div className={`stat-val${stats.lowBalanceCount ? ' amber' : ''}`}>{loading && !agents.length ? '—' : stats.lowBalanceCount.toLocaleString('en-NG')}</div>
          <div className="stat-sub">Agents under {naira(LOW_BALANCE)}</div>
        </div>
      </div>

      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Name, agent ID or location" label="Search agents" />
        <Segmented<Filter> label="Filter wallets" value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: counts.all },
          { value: 'low', label: 'Low balance', count: counts.low },
          { value: 'commission', label: 'Commission owed', count: counts.commission },
        ]} />
      </div>

      <section className="card" aria-label="Agent wallets">
        {loading && !agents.length ? <TableSkeleton rows={8} cols={6} />
          : failed ? <LoadError what="agent wallets" onRetry={load} />
          : filtered.length === 0 ? (
            q ? <Empty icon="search" title={`No agents match “${search.trim()}”`} text="Check the spelling, or search by agent ID or location." />
              : filter !== 'all' ? <Empty icon="check" title="Nothing here" text={filter === 'low' ? `No agent has less than ${naira(LOW_BALANCE)} right now.` : 'No agent is owed commission right now.'} />
              : <Empty icon="wallet" title="No agents yet" text="Agent wallets show here once agents are activated."
                  action={<Link href="/superadmin/agents" className="btn btn-outline">Go to agents</Link>} />
          ) : (
            <>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th className="num">Wallet</th>
                      <th className="num">Float limit</th>
                      <th className="num">Commission owed</th>
                      <th>Last top-up</th>
                      <th className="num">Topped up today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(a => {
                      const isLow = a.walletBalance < LOW_BALANCE
                      return (
                        <tr key={a.id}>
                          <td>
                            <Link href={`/superadmin/agents/${a.id}`} className="td-av am-link">
                              <Avatar name={a.name} photoUrl={a.photoUrl} tone={isLow ? 'amber' : 'green'} />
                              <span>
                                <span className="td-name ui-block">{a.name}</span>
                                <span className="td-sub ui-block">{a.agentId}</span>
                              </span>
                            </Link>
                          </td>
                          <td className="num" data-label="Wallet">
                            <span className={isLow ? 'am-warn' : 'am-strong'}>{naira(a.walletBalance)}</span>
                            {isLow && <> <span className="bdg bdg-a">Low</span></>}
                          </td>
                          <td className="num am-muted" data-label="Float limit">{a.floatLimit != null ? naira(a.floatLimit) : '—'}</td>
                          <td className="num" data-label="Commission owed">{a.commissionBalance > 0 ? <span className="am-strong">{naira(a.commissionBalance)}</span> : <span className="am-muted">{naira(0)}</span>}</td>
                          <td className="am-muted am-nowrap" data-label="Last top-up">{a.lastFunded ? shortDate(a.lastFunded) : 'Never'}</td>
                          <td className="num" data-label="Topped up today">{a.todayActivity > 0 ? <span className="am-pos">+{naira(a.todayActivity)}</span> : <span className="am-muted">—</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
            </>
          )}
      </section>
    </>
  )
}
