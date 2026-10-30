'use client'

import { Fragment, useState, useEffect, useCallback } from 'react'
import { Icons } from '@/components/ui/icons'
import {
  Avatar, Empty, LoadError, PageHeader, Segmented, TableSkeleton, shortDate, useToast,
} from '../_components/admin-ui'

interface Report {
  id: string
  agentName: string
  agentId: string
  category: string
  title: string
  description: string
  status: string
  createdAt: string
}

type Status = 'Open' | 'In Review' | 'Resolved'
type Tab = 'All' | Status
interface Counts { openCount: number; inReviewCount: number; resolvedCount: number }

const STATUS: Record<Status, { label: string; cls: string }> = {
  Open: { label: 'Open', cls: 'bdg-r' },
  'In Review': { label: 'In review', cls: 'bdg-a' },
  Resolved: { label: 'Resolved', cls: 'bdg-g' },
}

const DONE: Record<Status, string> = {
  Open: 'reopened',
  'In Review': 'marked as in review',
  Resolved: 'marked as resolved',
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status as Status] ?? { label: status, cls: 'bdg-grey' }
  return <span className={`bdg ${s.cls}`}>{s.label}</span>
}

async function errorOf(res: Response, fallback: string) {
  const d = await res.json().catch(() => ({})) as { error?: string }
  return d.error ?? fallback
}

const EMPTY: Record<Tab, { title: string; text: string }> = {
  All: { title: 'No reports yet', text: 'When an agent reports a problem from their app, it shows here.' },
  Open: { title: 'No open reports', text: 'Nothing is waiting for someone to pick it up.' },
  'In Review': { title: 'Nothing in review', text: 'Reports you start looking into show here.' },
  Resolved: { title: 'No resolved reports', text: 'Reports you close show here.' },
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [stats, setStats] = useState<Counts>({ openCount: 0, inReviewCount: 0, resolvedCount: 0 })
  const [tab, setTab] = useState<Tab>('All')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toastNode, toast] = useToast()

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const params = new URLSearchParams()
      if (tab !== 'All') params.set('status', tab)
      const res = await fetch(`/api/admin/reports?${params}`)
      if (!res.ok) throw new Error()
      const d = await res.json() as Partial<Counts> & { reports?: Report[] }
      setReports(d.reports ?? [])
      setStats({ openCount: d.openCount ?? 0, inReviewCount: d.inReviewCount ?? 0, resolvedCount: d.resolvedCount ?? 0 })
      setLoaded(true)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { load() }, [load])

  async function updateStatus(r: Report, status: Status) {
    setBusyId(r.id)
    try {
      const res = await fetch(`/api/admin/reports/${r.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) { toast(await errorOf(res, `“${r.title}” wasn’t updated. Try again.`), 'error'); return }
      toast(`“${r.title}” ${DONE[status]}`, 'success')
      load()
    } catch {
      toast('No connection. Check your internet and try again.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const total = stats.openCount + stats.inReviewCount + stats.resolvedCount
  const dash = !loaded

  return (
    <>
      <PageHeader title="Issue reports" sub="Problems agents have reported from their app. Pick them up, then mark them resolved." />

      {!loaded && failed ? null : (
        <div className="stats-grid lo-stats3" aria-busy={!loaded}>
          <div className="stat">
            <div className="stat-lbl">Open</div>
            <div className={`stat-val${stats.openCount > 0 ? ' red' : ''}`}>{dash ? '—' : stats.openCount.toLocaleString('en-NG')}</div>
            <div className="stat-sub">Waiting for someone</div>
          </div>
          <div className="stat">
            <div className="stat-lbl">In review</div>
            <div className="stat-val">{dash ? '—' : stats.inReviewCount.toLocaleString('en-NG')}</div>
            <div className="stat-sub">Being looked into</div>
          </div>
          <div className="stat">
            <div className="stat-lbl">Resolved</div>
            <div className="stat-val">{dash ? '—' : stats.resolvedCount.toLocaleString('en-NG')}</div>
            <div className="stat-sub">Closed</div>
          </div>
        </div>
      )}

      <div className="toolbar">
        <Segmented<Tab> label="Filter by status" value={tab} onChange={t => { setTab(t); setExpanded(null) }} options={[
          { value: 'All', label: 'All', count: loaded ? total : undefined },
          { value: 'Open', label: 'Open', count: loaded ? stats.openCount : undefined },
          { value: 'In Review', label: 'In review', count: loaded ? stats.inReviewCount : undefined },
          { value: 'Resolved', label: 'Resolved', count: loaded ? stats.resolvedCount : undefined },
        ]} />
      </div>

      <section className="card" aria-label="Issue reports">
        {loading && !loaded ? <TableSkeleton rows={6} cols={6} />
          : failed ? <LoadError what="issue reports" onRetry={load} />
          : reports.length === 0 ? <Empty icon={tab === 'All' ? 'report' : 'check'} title={EMPTY[tab].title} text={EMPTY[tab].text} />
          : (
            <div className="tbl-wrap tbl-stack">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th><th>Report</th><th>Category</th><th>Sent</th><th>Status</th><th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map(r => {
                    const open = expanded === r.id
                    const busy = busyId === r.id
                    const descId = `rp-desc-${r.id}`
                    return (
                      <Fragment key={r.id}>
                        <tr>
                          <td>
                            <div className="td-av">
                              <Avatar name={r.agentName} tone={r.status === 'Open' ? 'amber' : 'grey'} />
                              <span>
                                <span className="td-name ui-block">{r.agentName}</span>
                                <span className="td-sub ui-block">{r.agentId}</span>
                              </span>
                            </div>
                          </td>
                          <td data-label="Report">
                            <div>
                              <button type="button" className="lo-title-btn" aria-expanded={open} aria-controls={open ? descId : undefined} onClick={() => setExpanded(open ? null : r.id)}>
                                <span>{r.title}</span><Icons.expand size={16} aria-hidden="true" />
                              </button>
                              {!open && <div className="lo-desc">{r.description.length > 60 ? `${r.description.slice(0, 60)}…` : r.description}</div>}
                            </div>
                          </td>
                          <td data-label="Category"><span className="bdg bdg-grey">{r.category}</span></td>
                          <td data-label="Sent">{shortDate(r.createdAt)}</td>
                          <td data-label="Status"><StatusBadge status={r.status} /></td>
                          <td>
                            <div className="a-row-actions">
                              {r.status !== 'In Review' && r.status !== 'Resolved' && (
                                <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => updateStatus(r, 'In Review')}>Start review</button>
                              )}
                              {r.status !== 'Resolved' && (
                                <button type="button" className="btn btn-green btn-sm" disabled={busy} onClick={() => updateStatus(r, 'Resolved')}>{busy ? 'Saving…' : 'Mark resolved'}</button>
                              )}
                              {r.status === 'Resolved' && (
                                <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => updateStatus(r, 'Open')}>{busy ? 'Saving…' : 'Reopen'}</button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {open && (
                          <tr className="lo-expand">
                            <td colSpan={6} id={descId}>
                              <div className="lo-expand-lbl">What {r.agentName} wrote</div>
                              <div className="lo-expand-body">{r.description}</div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>

      {toastNode}
    </>
  )
}
