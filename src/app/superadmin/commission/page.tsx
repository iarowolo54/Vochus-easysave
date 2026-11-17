'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Avatar, Empty, LoadError, PageHeader, Pager, TableSkeleton, naira } from '../_components/admin-ui'
import { CommissionHistoryDrawer } from '../_components/commission-history-drawer'

// What agents have earned and are owed. The rates themselves live under Settings → Fees & commission.

interface LeaderboardEntry {
  rank: number
  id: string
  agentId: string
  name: string
  status: string
  customerCount: number
  savingsVolume: number
  commissionBalance: number
  photoUrl?: string | null
}

interface SystemCommission { savingsFees: number; loanShare: number; total: number }

interface PageData {
  totalPending: number
  totalDisbursed: number
  totalEarned: number
  leaderboard: LeaderboardEntry[]
  systemCommission: SystemCommission
}

const PAGE_SIZE = 25

export default function CommissionPage() {
  const [data, setData] = useState<PageData>({ totalPending: 0, totalDisbursed: 0, totalEarned: 0, leaderboard: [], systemCommission: { savingsFees: 0, loanShare: 0, total: 0 } })
  const [lbPage, setLbPage] = useState(1)
  const [historyAgent, setHistoryAgent] = useState<LeaderboardEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [boardFailed, setBoardFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setBoardFailed(false)
    const board = await fetch('/api/admin/commission').then(r => r.ok ? r.json() as Promise<Partial<PageData>> : null).catch(() => null)
    setBoardFailed(!board)
    if (board) setData({ totalPending: board.totalPending ?? 0, totalDisbursed: board.totalDisbursed ?? 0, totalEarned: board.totalEarned ?? 0, leaderboard: board.leaderboard ?? [], systemCommission: board.systemCommission ?? { savingsFees: 0, loanShare: 0, total: 0 } })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const owed = data.leaderboard.filter(a => a.commissionBalance > 0)
  const firstLoad = loading && !data.leaderboard.length && !boardFailed

  return (
    <>
      <PageHeader
        title="Commission"
        sub={<>What agents have earned and are owed. To change the rates, go to <Link href="/superadmin/settings/fees">Fees &amp; commission</Link>.</>}
      />

      <div className="stats-grid am-stats-4">
        <div className="stat">
          <div className="stat-lbl">Total commission earned</div>
          <div className="stat-val">{firstLoad ? '—' : naira(data.totalEarned)}</div>
          <div className="stat-sub">{data.leaderboard.length.toLocaleString('en-NG')} agents</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Waiting to be paid</div>
          <div className={`stat-val${data.totalPending > 0 ? ' amber' : ''}`}>{firstLoad ? '—' : naira(data.totalPending)}</div>
          <div className="stat-sub">{owed.length.toLocaleString('en-NG')} agent{owed.length === 1 ? '' : 's'} owed</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">Paid out</div>
          <div className="stat-val">{firstLoad ? '—' : naira(data.totalDisbursed)}</div>
          <div className="stat-sub">Agent withdrawals, all time</div>
        </div>
        <div className="stat">
          <div className="stat-lbl">System commission</div>
          <div className="stat-val">{firstLoad ? '—' : naira(data.systemCommission.total)}</div>
          <div className="stat-sub">Platform fees: new ones recorded, earlier redemptions worked out</div>
        </div>
      </div>

      {/* Commission by agent */}
      <section className="card" aria-labelledby="lb-h">
        <div className="card-hd">
          <div>
            <h3 id="lb-h">Commission by agent</h3>
            <p className="am-card-sub">Ranked by commission owed now. Savings volume is all time.</p>
          </div>
        </div>
        {firstLoad ? <TableSkeleton rows={6} cols={5} />
          : boardFailed && !data.leaderboard.length ? <LoadError what="agent commission" onRetry={load} />
          : data.leaderboard.length === 0 ? <Empty icon="customers" title="No agents yet" text="Agents and the commission they earn will show here."
              action={<Link href="/superadmin/agents" className="btn btn-outline">Go to agents</Link>} />
          : (
            <>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr><th>Agent</th><th className="num">Customers</th><th className="num">Savings volume</th><th className="num">Commission owed</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {data.leaderboard.slice((lbPage - 1) * PAGE_SIZE, lbPage * PAGE_SIZE).map(a => {
                      const hasPending = a.commissionBalance > 0
                      return (
                        <tr key={a.id}>
                          <td>
                            <button type="button" className="cm-cell-btn" onClick={() => setHistoryAgent(a)}
                              aria-label={`View commission history for ${a.name}`} title="View commission history">
                              <span className="am-rank" aria-label={`Rank ${a.rank}`}>{a.rank}</span>
                              <Avatar name={a.name} photoUrl={a.photoUrl} tone={hasPending ? 'amber' : 'green'} />
                              <span>
                                <span className="td-name ui-block">{a.name}</span>
                                <span className="td-sub ui-block">{a.agentId}</span>
                              </span>
                            </button>
                          </td>
                          <td className="num" data-label="Customers">{a.customerCount.toLocaleString('en-NG')}</td>
                          <td className="num" data-label="Savings volume">{naira(a.savingsVolume)}</td>
                          <td className="num am-strong" data-label="Commission owed">{naira(a.commissionBalance)}</td>
                          <td data-label="Status"><span className={`bdg ${hasPending ? 'bdg-a' : 'bdg-g'}`}>{hasPending ? 'Owed' : 'Paid up'}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={lbPage} pageSize={PAGE_SIZE} total={data.leaderboard.length} onPage={setLbPage} />
            </>
          )}
      </section>

      {historyAgent && (
        <CommissionHistoryDrawer agent={{ id: historyAgent.id, name: historyAgent.name, agentId: historyAgent.agentId }} onClose={() => setHistoryAgent(null)} />
      )}

    </>
  )
}
