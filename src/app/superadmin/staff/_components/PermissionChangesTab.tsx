'use client'

import { useCallback, useEffect, useState } from 'react'
import { Empty, LoadError, TableSkeleton, dateTime } from '../../_components/admin-ui'

type LogRow = { id: string; action: string; details: string | null; actorName: string | null; createdAt: string }

const TITLES: Record<string, string> = {
  staff_created: 'Person invited',
  staff_updated: 'Person updated',
  staff_deleted: 'Login removed',
  staff_invite_resent: 'Invite resent',
  role_created: 'Role created',
  role_updated: 'Role updated',
  department_created: 'Department created',
  department_updated: 'Department updated',
}
const PREFIXES = ['staff_', 'role_', 'department_']
const SHOWN = 60

// The log stores raw tokens ("status=Suspended", "[agents:view, …]"); show them in words.
function readable(details: string | null): string {
  return (details ?? '')
    .replace(/ with \[[^\]]*\]$/, '')
    .replace(/\bstatus=/g, 'status set to ')
    .replace(/\brole=/g, 'role set to ')
}

export default function PermissionChangesTab() {
  const [rows, setRows] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const pages = await Promise.all(PREFIXES.map(async p => {
        const res = await fetch(`/api/admin/audit?action=${p}&limit=${SHOWN}`)
        if (!res.ok) throw new Error()
        return ((await res.json()) as { logs?: LogRow[] }).logs ?? []
      }))
      setRows(pages.flat().filter(l => l.action in TITLES).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, SHOWN))
    } catch { setFailed(true) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <section className="card" aria-label="Permission changes">
      {loading ? <TableSkeleton rows={5} cols={3} />
        : failed ? <LoadError what="permission changes" onRetry={load} />
        : rows.length === 0 ? <Empty icon="staff" title="No changes yet" text="Changes to people, roles and departments appear here." />
        : (
          <ul className="um-log">
            {rows.map(l => (
              <li key={l.id}>
                <div className="um-log-main">
                  <span className="td-name ui-block">{TITLES[l.action]}</span>
                  <span className="td-sub ui-block">{readable(l.details)}</span>
                </div>
                <div className="um-log-meta">
                  <span className="ui-block">{l.actorName ?? 'System'}</span>
                  <span className="ui-block">{dateTime(l.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
