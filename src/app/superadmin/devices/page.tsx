'use client'

import { useState, useEffect, useCallback } from 'react'

interface Actor {
  kind: 'agent' | 'customer'
  id: string
  ref: string
  name: string
  phone: string
}

interface Device {
  id: string
  deviceId: string
  app: string
  platform: string | null
  model: string | null
  manufacturer: string | null
  osVersion: string | null
  appVersion: string | null
  ipAddress: string | null
  firstSeenAt: string
  lastSeenAt: string
  loginCount: number
  actor: Actor | null
}

const PAGE_SIZE = 25

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [appFilter, setAppFilter] = useState<'all' | 'agent' | 'customer'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    const q = search ? `?search=${encodeURIComponent(search)}` : ''
    const res = await fetch(`/api/admin/devices${q}`)
    const d = res.ok ? await res.json() : { devices: [] }
    setDevices(d.devices ?? [])
    setLoading(false)
    setPage(1)
  }, [search])

  useEffect(() => { load() }, [load])

  const filtered = appFilter === 'all' ? devices : devices.filter(d => d.app === appFilter)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const rel = (dateStr: string) => {
    const d = new Date(dateStr)
    const diff = Date.now() - d.getTime()
    const min = Math.floor(diff / 60000)
    if (min < 1) return 'just now'
    if (min < 60) return `${min} min ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr} hr ago`
    const day = Math.floor(hr / 24)
    if (day < 30) return `${day} d ago`
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>Device Registry</h1>
          <p>Every device that has signed in via the mobile apps</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div className="a-topbar-search" style={{ minWidth: 240 }}>
            <span style={{ color: 'var(--text3)' }}>🔍</span>
            <input
              type="text"
              placeholder="Serial, model, name, ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            value={appFilter}
            onChange={e => setAppFilter(e.target.value as 'all' | 'agent' | 'customer')}
            style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--surface)', fontSize: 13, fontWeight: 600 }}
          >
            <option value="all">All apps</option>
            <option value="agent">Agent app</option>
            <option value="customer">Customer app</option>
          </select>
        </div>
      </div>

      <div className="card">
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>
          {filtered.length} device{filtered.length !== 1 ? 's' : ''} · {devices.filter(d => d.app === 'agent').length} agent · {devices.filter(d => d.app === 'customer').length} customer
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>App</th>
                <th>User</th>
                <th>Model</th>
                <th>OS</th>
                <th>Logins</th>
                <th>Last seen</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td></tr>}
              {!loading && paginated.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No mobile devices have signed in yet</td></tr>
              )}
              {!loading && paginated.map(d => (
                <tr key={d.id}>
                  <td>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text2)' }}>{d.deviceId.length > 24 ? d.deviceId.slice(0, 24) + '…' : d.deviceId}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{d.platform ?? '—'}</div>
                  </td>
                  <td>
                    <span className={`bdg ${d.app === 'agent' ? 'bdg-b' : 'bdg-g'}`}>{d.app}</span>
                  </td>
                  <td>
                    {d.actor
                      ? <><div className="td-name">{d.actor.name}</div><div className="td-sub">{d.actor.ref} · {d.actor.phone}</div></>
                      : <span style={{ color: 'var(--text3)' }}>—</span>}
                  </td>
                  <td>
                    <div style={{ fontSize: 13 }}>{d.model ?? '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{d.manufacturer ?? ''}</div>
                  </td>
                  <td style={{ fontSize: 12.5, color: 'var(--text2)' }}>{d.osVersion ?? '—'}</td>
                  <td style={{ fontWeight: 600 }}>{d.loginCount}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--text2)' }}>{rel(d.lastSeenAt)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'monospace' }}>{d.ipAddress ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button className="btn btn-outline btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span style={{ fontSize: 13, color: 'var(--text2)', alignSelf: 'center' }}>Page {page} of {totalPages}</span>
            <button className="btn btn-outline btn-sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </div>
    </>
  )
}
