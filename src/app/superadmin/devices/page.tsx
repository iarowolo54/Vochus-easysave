'use client'

import { useState, useEffect, useCallback } from 'react'
import { Icons } from '@/components/ui/icons'
import {
  Empty, LoadError, PageHeader, Pager, SearchField, Segmented, TableSkeleton, dateTime, shortDate, useDebounced,
} from '../_components/admin-ui'

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

type AppFilter = 'all' | 'agent' | 'customer'

const PAGE_SIZE = 25

function rel(dateStr: string) {
  const d = new Date(dateStr)
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`
  return shortDate(d)
}

const APP_LABEL: Record<string, string> = { agent: 'Agent app', customer: 'Customer app' }

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim())
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [page, setPage] = useState(1)
  const [appFilter, setAppFilter] = useState<AppFilter>('all')

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch(`/api/admin/devices${q ? `?search=${encodeURIComponent(q)}` : ''}`)
      if (!res.ok) throw new Error()
      const d = await res.json() as { devices?: Device[] }
      setDevices(d.devices ?? [])
      setLoaded(true)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [q])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [q, appFilter])

  const counts = {
    all: devices.length,
    agent: devices.filter(d => d.app === 'agent').length,
    customer: devices.filter(d => d.app === 'customer').length,
  }
  const filtered = appFilter === 'all' ? devices : devices.filter(d => d.app === appFilter)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <>
      <PageHeader title="Devices" sub="Every phone that has signed in to the agent or customer app." />

      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Device ID, model, name or phone" label="Search devices" />
        <Segmented<AppFilter> label="Filter by app" value={appFilter} onChange={setAppFilter} options={[
          { value: 'all', label: 'All apps', count: loaded ? counts.all : undefined },
          { value: 'agent', label: 'Agent app', count: loaded ? counts.agent : undefined },
          { value: 'customer', label: 'Customer app', count: loaded ? counts.customer : undefined },
        ]} />
      </div>

      <section className="card" aria-label="Devices">
        {loading && !loaded ? <TableSkeleton rows={8} cols={6} />
          : failed ? <LoadError what="devices" onRetry={load} />
          : filtered.length === 0 ? (
            q ? <Empty icon="search" title={`No devices match “${q}”`} text="Try a device ID, phone model, or the person’s name or phone number." />
              : appFilter !== 'all' ? <Empty icon="device" title={`No ${APP_LABEL[appFilter].toLowerCase()} devices`} text="No one has signed in on this app yet." />
              : <Empty icon="device" title="No devices yet" text="Devices show here after someone signs in on the agent or customer app." />
          ) : (
            <>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr>
                      <th>User</th><th>App</th><th>Device</th><th>Model</th><th>OS</th>
                      <th className="num">Sign-ins</th><th>Last seen</th><th>IP address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(d => (
                      <tr key={d.id}>
                        <td>
                          <div className="td-av">
                            <span className="row-ic" aria-hidden="true"><Icons.device size={18} /></span>
                            {d.actor ? (
                              <span>
                                <span className="td-name ui-block">{d.actor.name}</span>
                                <span className="td-sub ui-block">{d.actor.ref} · {d.actor.phone}</span>
                              </span>
                            ) : (
                              <span className="td-name lo-muted">No account linked</span>
                            )}
                          </div>
                        </td>
                        <td data-label="App"><span className={`bdg ${d.app === 'agent' ? 'bdg-b' : 'bdg-g'}`}>{APP_LABEL[d.app] ?? d.app}</span></td>
                        <td data-label="Device">
                          <div>
                            <div className="lo-mono" title={d.deviceId}>{d.deviceId.length > 24 ? `${d.deviceId.slice(0, 24)}…` : d.deviceId}</div>
                            <div className="td-sub">{d.platform ?? '—'}{d.appVersion ? ` · app ${d.appVersion}` : ''}</div>
                          </div>
                        </td>
                        <td data-label="Model">
                          <div>
                            <div>{d.model ?? '—'}</div>
                            {d.manufacturer && <div className="td-sub">{d.manufacturer}</div>}
                          </div>
                        </td>
                        <td data-label="OS">{d.osVersion ?? '—'}</td>
                        <td className="num" data-label="Sign-ins">{d.loginCount.toLocaleString('en-NG')}</td>
                        <td data-label="Last seen">
                          <div>
                            <time dateTime={d.lastSeenAt} title={dateTime(d.lastSeenAt)}>{rel(d.lastSeenAt)}</time>
                            <div className="td-sub">First seen {shortDate(d.firstSeenAt)}</div>
                          </div>
                        </td>
                        <td data-label="IP address"><span className="lo-mono">{d.ipAddress ?? '—'}</span></td>
                      </tr>
                    ))}
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
