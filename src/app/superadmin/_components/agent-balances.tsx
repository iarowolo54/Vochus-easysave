'use client'

import { useState, useEffect, useCallback } from 'react'
import { Avatar, Empty, LoadError, Pager, SearchField, TableSkeleton, naira, shortDate } from './admin-ui'

// Treasury → Agent balances: every agent's wallet and commission balance (moved here from the old Wallet accounts page).

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

interface AgentsData {
  agents: AgentWallet[]
  totalWalletBalance: number
  lowBalanceCount: number
}

const PAGE_SIZE = 25
const LOW_BALANCE = 10000 // same threshold the wallets API uses for lowBalanceCount

export function AgentBalances() {
  const [agentsData, setAgentsData] = useState<AgentsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [agentsFailed, setAgentsFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true); setAgentsFailed(false)
    try {
      const res = await fetch('/api/admin/wallets')
      if (!res.ok) throw new Error()
      const agent = await res.json() as Partial<AgentsData>
      setAgentsData({ agents: agent.agents ?? [], totalWalletBalance: agent.totalWalletBalance ?? 0, lowBalanceCount: agent.lowBalanceCount ?? 0 })
    } catch {
      setAgentsFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search])

  const term = search.trim().toLowerCase()
  const agents = agentsData?.agents ?? []
  const filteredAgents = agents.filter(a => !term ||
    a.name.toLowerCase().includes(term) || a.agentId.toLowerCase().includes(term) || (a.location ?? '').toLowerCase().includes(term))
  const paginated = filteredAgents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <>
      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Name, agent ID or location" label="Search agent balances" />
      </div>
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
                    {paginated.map(a => {
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
              <Pager page={page} pageSize={PAGE_SIZE} total={filteredAgents.length} onPage={setPage} />
              <p className="cm-foot">Low balance means under {naira(LOW_BALANCE)}. {agentsData && `${naira(agentsData.totalWalletBalance)} across all agent wallets.`}</p>
            </>
          )}
      </section>    </>
  )
}
