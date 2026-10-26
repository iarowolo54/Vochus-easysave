'use client'

import { useState, useEffect, useCallback } from 'react'

interface Customer {
  id: string
  customerId: string
  name: string
  phone: string
  email: string | null
  address: string
  status: string
  agentName: string
  agentId: string
  totalBalance: number
  activePlans: number
  createdAt: string
  photoUrl?: string | null
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [toggling, setToggling] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [detailRecord, setDetailRecord] = useState<Customer | null>(null)
  const perPage = 20

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500) }

  async function toggleLock(c: Customer) {
    const next = c.status === 'Active' ? 'Locked' : 'Active'
    const verb = next === 'Locked' ? 'Lock' : 'Unlock'
    if (!confirm(`${verb} ${c.name} (${c.customerId})?\n\n${next === 'Locked' ? 'They will not be able to sign in until unlocked.' : 'They will be able to sign in again.'}`)) return
    setToggling(c.id)
    const res = await fetch(`/api/admin/customers/${c.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    setToggling(null)
    if (res.ok) {
      const updated = { ...c, status: next }
      setCustomers(prev => prev.map(x => x.id === c.id ? updated : x))
      if (detailRecord?.id === c.id) setDetailRecord(updated)
      showToast(`✅ ${c.name} ${next === 'Locked' ? 'locked' : 'unlocked'}`)
    } else {
      const d = await res.json().catch(() => ({}))
      showToast(d.error ?? `${verb} failed`)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    const q = search ? `?search=${encodeURIComponent(search)}` : ''
    const res = await fetch(`/api/admin/customers${q}`)
    const d = res.ok ? await res.json() : {}
    setCustomers(d.customers ?? [])
    setLoading(false)
    setPage(1)
  }, [search])

  useEffect(() => { load() }, [load])

  const fmt = (n: number) => `₦${n.toLocaleString()}`
  const paginated = customers.slice((page - 1) * perPage, page * perPage)
  const totalPages = Math.ceil(customers.length / perPage)

  const Section = ({ title }: { title: string }) => (
    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase', color: 'var(--text3)', margin: '20px 0 8px', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>{title}</div>
  )
  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)', gap: 12 }}>
      <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', textAlign: 'right' }}>{value ?? '—'}</span>
    </div>
  )

  return (
    <>
      <div className="pg-hd">
        <div>
          <h1>All Customers</h1>
          <p>Platform-wide customer directory across all agents</p>
        </div>
        <div className="a-topbar-search" style={{ minWidth: 260 }}>
          <span style={{ color: 'var(--text3)' }}>🔍</span>
          <input
            type="text"
            placeholder="Search customers…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>{customers.length} customer{customers.length !== 1 ? 's' : ''} found</div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th>Agent</th>
                <th>Savings Balance</th>
                <th>Active Plans</th>
                <th>Status</th>
                <th>Enrolled</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>Loading…</td></tr>
              )}
              {!loading && paginated.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text3)', padding: 24 }}>No customers found</td></tr>
              )}
              {!loading && paginated.map(c => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={e => { if ((e.target as HTMLElement).closest('button')) return; setDetailRecord(c) }}>
                  <td>
                    <div className="td-av">
                      {c.photoUrl ? <img src={c.photoUrl} className="av" style={{ objectFit: 'cover', borderRadius: '50%' }} alt="" /> : <div className="av av-blue">{c.name.split(' ').map(w => w[0]).join('').slice(0,2)}</div>}
                      <div>
                        <div className="td-name">{c.name}</div>
                        <div className="td-sub">{c.customerId}</div>
                      </div>
                    </div>
                  </td>
                  <td>{c.phone}</td>
                  <td>
                    <div className="td-name">{c.agentName}</div>
                    <div className="td-sub">{c.agentId}</div>
                  </td>
                  <td style={{ fontWeight: 600, color: 'var(--green)' }}>{fmt(c.totalBalance)}</td>
                  <td>{c.activePlans}</td>
                  <td><span className={`bdg ${c.status === 'Active' ? 'bdg-g' : 'bdg-r'}`}>{c.status}</span></td>
                  <td style={{ color: 'var(--text3)', fontSize: 12 }}>{new Date(c.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td>
                    <button
                      className={`btn btn-xs ${c.status === 'Active' ? 'btn-danger' : 'btn-green'}`}
                      onClick={() => toggleLock(c)}
                      disabled={toggling === c.id}
                      title={c.status === 'Active' ? 'Prevent this customer from signing in' : 'Allow this customer to sign in again'}
                    >
                      {toggling === c.id ? '…' : c.status === 'Active' ? '🔒 Lock' : '🔓 Unlock'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={`a-toast${toast ? ' show' : ''}`}>{toast}</div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button className="btn btn-outline btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span style={{ fontSize: 13, color: 'var(--text2)', alignSelf: 'center' }}>Page {page} of {totalPages}</span>
            <button className="btn btn-outline btn-sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </div>

      {detailRecord && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }} onClick={() => setDetailRecord(null)}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,.45)' }} />
          <div style={{ width: 420, background: 'var(--surface)', height: '100%', overflowY: 'auto', padding: 28, boxShadow: '-8px 0 40px rgba(0,0,0,.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{detailRecord.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{detailRecord.customerId}</div>
              </div>
              <button className="btn btn-outline btn-xs" onClick={() => setDetailRecord(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 4 }}>
              {detailRecord.photoUrl
                ? <img src={detailRecord.photoUrl} style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }} alt="" />
                : <div className="av av-blue" style={{ width: 56, height: 56, fontSize: 22 }}>{detailRecord.name.split(' ').map(w => w[0]).join('').slice(0,2)}</div>
              }
              <span className={`bdg ${detailRecord.status === 'Active' ? 'bdg-g' : 'bdg-r'}`}>{detailRecord.status}</span>
            </div>

            <Section title="Contact" />
            <Row label="Phone" value={detailRecord.phone} />
            <Row label="Email" value={detailRecord.email} />
            <Row label="Address" value={detailRecord.address} />

            <Section title="Agent" />
            <Row label="Agent Name" value={detailRecord.agentName} />
            <Row label="Agent ID" value={detailRecord.agentId} />

            <Section title="Savings" />
            <Row label="Total Balance" value={<span style={{ color: 'var(--green)', fontWeight: 700 }}>{fmt(detailRecord.totalBalance)}</span>} />
            <Row label="Active Plans" value={detailRecord.activePlans} />

            <Section title="Account" />
            <Row label="Enrolled" value={new Date(detailRecord.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />

            <div style={{ marginTop: 24 }}>
              <button
                className={`btn ${detailRecord.status === 'Active' ? 'btn-danger' : 'btn-green'}`}
                style={{ width: '100%' }}
                disabled={toggling === detailRecord.id}
                onClick={() => toggleLock(detailRecord)}
              >
                {toggling === detailRecord.id ? '…' : detailRecord.status === 'Active' ? '🔒 Lock Account' : '🔓 Unlock Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
