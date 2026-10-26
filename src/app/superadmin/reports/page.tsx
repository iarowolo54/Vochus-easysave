'use client'

import { useState, useEffect, useCallback } from 'react'

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

const TABS = ['All', 'Open', 'In Review', 'Resolved']

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [stats, setStats] = useState({ openCount: 0, inReviewCount: 0, resolvedCount: 0 })
  const [tab, setTab] = useState('All')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (tab !== 'All') params.set('status', tab)
    const res = await fetch(`/api/admin/reports?${params}`)
    const d = res.ok ? await res.json() : {}
    setReports(d.reports ?? [])
    setStats({ openCount: d.openCount ?? 0, inReviewCount: d.inReviewCount ?? 0, resolvedCount: d.resolvedCount ?? 0 })
    setLoading(false)
  }, [tab])

  useEffect(() => { load() }, [load])

  async function updateStatus(id: string, status: string) {
    const res = await fetch(`/api/admin/reports/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      showToast(`Report marked as ${status}`)
      load()
    } else {
      showToast('Failed to update status')
    }
  }

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  function statusBadge(status: string) {
    if (status === 'Open') return <span className="bdg bdg-r">Open</span>
    if (status === 'In Review') return <span className="bdg bdg-a">In Review</span>
    return <span className="bdg bdg-g">Resolved</span>
  }

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>Issue Reports</h1>
          <p>Agent-submitted issue reports and support tickets</p>
        </div>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat">
          <span className="stat-ic">🔴</span>
          <div className="stat-lbl">Open</div>
          <div className="stat-val red">{stats.openCount}</div>
          <div className="stat-sub">Awaiting action</div>
        </div>
        <div className="stat">
          <span className="stat-ic">🟡</span>
          <div className="stat-lbl">In Review</div>
          <div className="stat-val amber">{stats.inReviewCount}</div>
          <div className="stat-sub">Being investigated</div>
        </div>
        <div className="stat">
          <span className="stat-ic">🟢</span>
          <div className="stat-lbl">Resolved</div>
          <div className="stat-val green">{stats.resolvedCount}</div>
          <div className="stat-sub">Closed issues</div>
        </div>
      </div>

      <div className="card">
        <div className="tab-bar">
          {TABS.map(t => (
            <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t}
              {t === 'Open' && stats.openCount > 0 && <span className="bdg bdg-r" style={{ marginLeft: 6 }}>{stats.openCount}</span>}
            </button>
          ))}
        </div>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Category</th>
                <th>Title</th>
                <th>Description</th>
                <th>Submitted</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td></tr>}
              {!loading && reports.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No reports found</td></tr>}
              {!loading && reports.flatMap(r => {
                const rows = [
                  <tr key={r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <td>
                      <div className="td-av">
                        <div className="av av-amber">{r.agentName.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
                        <div>
                          <div className="td-name">{r.agentName}</div>
                          <div className="td-sub">{r.agentId}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className="bdg bdg-grey">{r.category}</span></td>
                    <td style={{ fontWeight: 500, maxWidth: 180 }}>{r.title}</td>
                    <td style={{ color: 'var(--text2)', fontSize: 12, maxWidth: 220 }}>
                      {r.description.length > 60 ? r.description.slice(0, 60) + '…' : r.description}
                    </td>
                    <td style={{ color: 'var(--text3)', fontSize: 12 }}>{fmtDate(r.createdAt)}</td>
                    <td>{statusBadge(r.status)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {r.status !== 'In Review' && r.status !== 'Resolved' && (
                          <button className="btn btn-outline btn-xs" onClick={() => updateStatus(r.id, 'In Review')}>Review</button>
                        )}
                        {r.status !== 'Resolved' && (
                          <button className="btn btn-green btn-xs" onClick={() => updateStatus(r.id, 'Resolved')}>Resolve</button>
                        )}
                        {r.status === 'Resolved' && (
                          <button className="btn btn-outline btn-xs" onClick={() => updateStatus(r.id, 'Open')}>Reopen</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ]
                if (expanded === r.id) {
                  rows.push(
                    <tr key={`${r.id}-exp`}>
                      <td colSpan={7} style={{ background: 'var(--surface2)', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Full Description</div>
                        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{r.description}</div>
                      </td>
                    </tr>
                  )
                }
                return rows
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`a-toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  )
}
