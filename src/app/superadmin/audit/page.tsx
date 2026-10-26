'use client'

import { useState, useEffect, useCallback } from 'react'

interface AuditLog {
  id: string
  action: string
  entity: string
  entityId: string | null
  details: string | null
  actorType: string
  actorId: string | null
  actorName: string | null
  createdAt: string
}

const ACTION_FILTERS = [
  { key: '', label: 'All' },
  { key: 'Saving', label: 'Saving' },
  { key: 'Redemption', label: 'Redemption' },
  { key: 'Loan', label: 'Loan' },
  { key: 'Enrolment', label: 'Enrolment' },
  { key: 'Agent', label: 'Agent' },
]

const ACTION_EMOJI: Record<string, string> = {
  saving: '💰',
  redemption: '🎯',
  loan: '🏦',
  enrolment: '📋',
  agent: '🤝',
  repayment: '🔄',
  disbursement: '💸',
}

const ACTION_BG: Record<string, string> = {
  saving: 'var(--green)',
  redemption: 'var(--red)',
  loan: 'var(--purple)',
  enrolment: 'var(--teal)',
  agent: 'var(--amber)',
  repayment: 'var(--blue)',
  disbursement: 'var(--purple)',
}

function getEmoji(action: string): string {
  const key = action.toLowerCase()
  for (const k of Object.keys(ACTION_EMOJI)) {
    if (key.includes(k)) return ACTION_EMOJI[k]
  }
  return '📝'
}

function getBg(action: string): string {
  const key = action.toLowerCase()
  for (const k of Object.keys(ACTION_BG)) {
    if (key.includes(k)) return ACTION_BG[k]
  }
  return 'var(--text3)'
}

const PAGE_SIZE = 30

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (action) params.set('action', action)
    const res = await fetch(`/api/admin/audit?${params}`)
    const d = res.ok ? await res.json() : {}
    setLogs(d.logs ?? [])
    setPage(1)
    setLoading(false)
  }, [search, action])

  useEffect(() => { load() }, [load])

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>Audit Log</h1>
          <p>System-wide audit trail</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, fontFamily: 'IBM Plex Sans', background: 'var(--surface2)', color: 'var(--text)', minWidth: 180 }}
          />
          <select
            value={action}
            onChange={e => setAction(e.target.value)}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, fontFamily: 'IBM Plex Sans', background: 'var(--surface2)', color: 'var(--text)' }}
          >
            {ACTION_FILTERS.map(f => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <button className="btn btn-sm btn-primary" onClick={load} style={{ marginLeft: 'auto' }}>
            Refresh
          </button>
        </div>
      </div>

      <div className="card">
        {loading && (
          <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 32 }}>Loading…</div>
        )}
        {!loading && logs.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 32 }}>No audit entries found</div>
        )}
        {!loading && logs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(log => (
          <div key={log.id} className="audit-row">
            <div
              className="audit-ic"
              style={{ background: getBg(log.action) }}
            >
              {getEmoji(log.action)}
            </div>
            <div className="audit-text">
              <div style={{ fontWeight: 600, fontSize: 14 }}>{log.action}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                {log.entity}{log.entityId ? ` · ${log.entityId}` : ''}
                {log.details ? ` — ${log.details}` : ''}
              </div>
              {(log.actorName || log.actorId) && (
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                  {log.actorType}: {log.actorName ?? log.actorId}
                </div>
              )}
            </div>
            <div className="audit-time">{fmtDate(log.createdAt)}</div>
          </div>
        ))}
        {!loading && Math.ceil(logs.length / PAGE_SIZE) > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, logs.length)} of {logs.length}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn btn-xs btn-outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 80, textAlign: 'center' }}>Page {page} of {Math.ceil(logs.length / PAGE_SIZE)}</span>
              <button className="btn btn-xs btn-outline" disabled={page === Math.ceil(logs.length / PAGE_SIZE)} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
