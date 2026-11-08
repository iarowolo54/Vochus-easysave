'use client'

import { useCallback, useEffect, useState } from 'react'
import { Empty, LoadError, PageHeader, TableSkeleton, naira } from '../_components/admin-ui'

type Group = {
  id: string; name: string; status: string; cadence: string; size: number; contribution: number; pot: number
  agentName: string; agentCode: string; memberCount: number; round: number | null; roundLabel: string | null
  paidThisRound: number; dueDay: string | null; overdue: boolean; inPool: number; paidOutRounds: number
}

const STATUS: Record<string, [string, string]> = {
  Forming: ['Getting members', 'bdg-b'], Running: ['Running', 'bdg-g'], Completed: ['Finished', 'bdg-grey'], Cancelled: ['Cancelled', 'bdg-grey'],
}

export default function AjoGroupsAdminPage() {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch('/api/admin/ajo', { cache: 'no-store' })
      if (!res.ok) throw new Error()
      setGroups(((await res.json()) as { groups: Group[] }).groups)
    } catch { setFailed(true) }
  }, [])
  useEffect(() => { load() }, [load])

  const overdue = groups?.filter(g => g.overdue).length ?? 0
  const held = groups?.reduce((s, g) => s + g.inPool, 0) ?? 0

  return (
    <>
      <PageHeader title="Ajo groups" sub="Groups agents run, the money waiting in each, and turns that are overdue. Payouts appear under Redemptions." />
      {failed && !groups ? <section className="card"><LoadError what="Ajo groups" onRetry={load} /></section> : (
        <>
          <div className="stats-grid am-stats-3">
            <div className="stat"><div className="stat-lbl">Groups running</div><div className="stat-val">{groups ? groups.filter(g => g.status === 'Running').length : '—'}</div></div>
            <div className="stat"><div className="stat-lbl">Paid in, not yet paid out</div><div className="stat-val">{groups ? naira(held) : '—'}</div></div>
            <div className="stat"><div className="stat-lbl">Overdue turns</div><div className="stat-val">{groups ? overdue : '—'}</div></div>
          </div>
          <section className="card" aria-labelledby="ajo-h">
            <div className="card-hd"><h3 id="ajo-h">Groups</h3></div>
            {!groups ? <TableSkeleton rows={4} cols={6} />
              : groups.length === 0 ? <Empty icon="staff" title="No Ajo groups yet" text="Groups show here when agents create them." />
              : (
                <div className="tbl-wrap tbl-stack">
                  <table>
                    <thead><tr><th>Group</th><th>Agent</th><th className="num">Each pays</th><th>This turn</th><th className="num">In the pool</th><th>Status</th></tr></thead>
                    <tbody>
                      {groups.map(g => {
                        const [label, cls] = STATUS[g.status] ?? [g.status, 'bdg-grey']
                        return (
                          <tr key={g.id}>
                            <td className="td-name">{g.name}<div className="am-muted">{g.memberCount} of {g.size} members · {g.cadence}</div></td>
                            <td data-label="Agent">{g.agentName}<div className="am-muted">{g.agentCode}</div></td>
                            <td className="num" data-label="Each pays">{naira(g.contribution)}</td>
                            <td data-label="This turn">{g.roundLabel ? <>{g.roundLabel}<div className="am-muted">{g.paidThisRound} of {g.size} paid</div></> : <span className="am-muted">None</span>}</td>
                            <td className="num am-strong" data-label="In the pool">{naira(g.inPool)}</td>
                            <td data-label="Status"><span className={`bdg ${g.overdue ? 'bdg-a' : cls}`}>{g.overdue ? 'Overdue' : label}</span></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </section>
        </>
      )}
    </>
  )
}
