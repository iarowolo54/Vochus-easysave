'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import {
  Avatar, ConfirmModal, Empty, LoadError, Modal, PageHeader, Pager, SearchField, Segmented,
  TableSkeleton, naira, shortDate, useDebounced, useToast,
} from '../_components/admin-ui'
import { ClearSignInLockModal, SendResetCodeModal } from '../_components/send-reset-code'

interface Customer {
  id: string
  /** True while the account is locked to one phone. */
  deviceBound?: boolean
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
  // Newer profile fields. The list API may not send them yet; older customers have null.
  gender?: string | null
  state?: string | null
  lga?: string | null
  /** Offline = agent-created cash saver; online = self-registered. Missing until the API sends it. */
  type?: CustomerType
  lastPaidAt?: string | null
}

type Filter = 'all' | 'active' | 'locked'
type CustomerType = 'offline' | 'online'
type TypeFilter = 'all' | CustomerType

const OVERDUE_DAYS = 3

/** Whole calendar days since the last saving; null if never paid. */
function daysSince(iso: string | null | undefined) {
  if (!iso) return null
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((start(new Date()) - start(new Date(iso))) / 86400000)
}

function lastPaidText(iso: string | null | undefined) {
  const d = daysSince(iso)
  if (d === null) return 'Never'
  if (d <= 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d} days ago`
}

/** A cash saver with a running plan who hasn't paid the agent in a while. */
const isOverdue = (c: Customer) => {
  const d = daysSince(c.lastPaidAt)
  return c.type === 'offline' && c.activePlans > 0 && (d === null || d >= OVERDUE_DAYS)
}

function TypeBadge({ type }: { type: CustomerType }) {
  return type === 'offline'
    ? <span className="bdg bdg-a">Cash saver</span>
    : <span className="bdg bdg-b">Online</span>
}

const PAGE_SIZE = 20

async function errorOf(res: Response, fallback: string) {
  const d = await res.json().catch(() => ({})) as { error?: string }
  return d.error ?? fallback
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'Active') return <span className="bdg bdg-g">Active</span>
  if (status === 'Locked') return <span className="bdg bdg-r">Locked</span>
  return <span className="bdg bdg-grey">{status}</span>
}

function DlRow({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>
}

const orNotRecorded = (v: string | null | undefined) => v ? v : <span className="cm-not-recorded">Not recorded</span>
const orDash = (v: string | null | undefined) => v ? v : <span className="cm-not-recorded">—</span>

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim())
  const [filter, setFilter] = useState<Filter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [toastNode, toast] = useToast()
  const [detail, setDetail] = useState<Customer | null>(null)

  // Lock / unlock confirmation
  const [lockTarget, setLockTarget] = useState<Customer | null>(null)
  const [sendCodeFor, setSendCodeFor] = useState<Customer | null>(null)
  const [clearLockFor, setClearLockFor] = useState<Customer | null>(null)
  const [resetDeviceFor, setResetDeviceFor] = useState<Customer | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState('')
  const [lockBusy, setLockBusy] = useState(false)
  const [lockError, setLockError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch(`/api/admin/customers${q ? `?search=${encodeURIComponent(q)}` : ''}`)
      if (!res.ok) throw new Error()
      const d = await res.json() as { customers?: Customer[] }
      setCustomers(d.customers ?? [])
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [q])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [q, filter, typeFilter])

  function askLock(c: Customer) {
    setLockError(''); setLockTarget(c)
  }

  async function resetDevice() {
    const c = resetDeviceFor
    if (!c) return
    setResetBusy(true); setResetError('')
    try {
      const res = await fetch(`/api/admin/customers/${c.id}/reset-device`, { method: 'POST' })
      if (!res.ok) { setResetError(await errorOf(res, 'The device wasn’t reset. Try again.')); return }
      setCustomers(prev => prev.map(x => x.id === c.id ? { ...x, deviceBound: false } : x))
      toast(`${c.name} can now sign in on a new phone`, 'success')
      setResetDeviceFor(null)
    } catch {
      setResetError('No connection. Check your internet and try again.')
    } finally {
      setResetBusy(false)
    }
  }

  async function toggleLock() {
    const c = lockTarget
    if (!c) return
    const next = c.status === 'Active' ? 'Locked' : 'Active'
    setLockBusy(true); setLockError('')
    try {
      const res = await fetch(`/api/admin/customers/${c.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) { setLockError(await errorOf(res, 'The account wasn’t changed. Try again.')); return }
      const updated = { ...c, status: next }
      setCustomers(prev => prev.map(x => x.id === c.id ? updated : x))
      setDetail(prev => prev?.id === c.id ? updated : prev)
      toast(next === 'Locked' ? `${c.name} is locked out` : `${c.name} can sign in again`, 'success')
      setLockTarget(null)
    } catch {
      setLockError('No connection. Check your internet and try again.')
    } finally {
      setLockBusy(false)
    }
  }

  // The split only appears once the API sends a type for each customer.
  const typed = customers.some(c => c.type !== undefined)
  const ofType = typed && typeFilter !== 'all' ? customers.filter(c => c.type === typeFilter) : customers
  const counts = {
    all: ofType.length,
    active: ofType.filter(c => c.status === 'Active').length,
    locked: ofType.filter(c => c.status === 'Locked').length,
  }
  const typeCounts = {
    all: customers.length,
    offline: customers.filter(c => c.type === 'offline').length,
    online: customers.filter(c => c.type === 'online').length,
  }
  const overdue = customers.filter(isOverdue).length
  const shown = ofType.filter(c => filter === 'all' ? true : filter === 'active' ? c.status === 'Active' : c.status === 'Locked')
  const paginated = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const hasProfileFields = (c: Customer) => 'gender' in c || 'state' in c || 'lga' in c

  return (
    <>
      <PageHeader
        title="Customers"
        sub={loading && !customers.length ? 'Loading…' : failed && !customers.length ? 'Customers across all agents.' : `${typeCounts.all.toLocaleString('en-NG')} customer${typeCounts.all === 1 ? '' : 's'} across all agents${typed && overdue ? ` · ${overdue} cash saver${overdue === 1 ? '' : 's'} not paid in ${OVERDUE_DAYS}+ days` : ''}`}
      />

      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Name, customer ID or phone" label="Search customers" />
        {typed && (
          <Segmented<TypeFilter> label="Customer type" value={typeFilter} onChange={setTypeFilter} options={[
            { value: 'all', label: 'All types', count: typeCounts.all },
            { value: 'offline', label: 'Cash savers', count: typeCounts.offline },
            { value: 'online', label: 'Online', count: typeCounts.online },
          ]} />
        )}
        <Segmented<Filter> label="Filter customers" value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: failed && !customers.length ? undefined : counts.all },
          { value: 'active', label: 'Active', count: failed && !customers.length ? undefined : counts.active },
          { value: 'locked', label: 'Locked', count: failed && !customers.length ? undefined : counts.locked },
        ]} />
      </div>

      <section className="card" aria-label="Customers">
        {loading && !customers.length ? <TableSkeleton rows={8} cols={6} />
          : failed ? <LoadError what="customers" onRetry={load} />
          : shown.length === 0 ? (
            q ? <Empty icon="search" title={`No customers match “${q}”`} text="Check the spelling, or search by customer ID or phone number." />
              : filter !== 'all' ? <Empty icon="check" title="Nothing here" text={filter === 'locked' ? 'No customers are locked right now.' : 'No active customers right now.'} />
              : typed && typeFilter !== 'all' ? <Empty icon="customers" title={typeFilter === 'offline' ? 'No cash savers yet' : 'No online customers yet'}
                  text={typeFilter === 'offline' ? 'Customers an agent enrols and collects cash from show here.' : 'Customers who sign up from an agent’s invite show here.'} />
              : <Empty icon="customers" title="No customers yet" text="Customers show here once an agent enrols them." />
          ) : (
            <>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th><th>Phone</th><th>Agent</th>
                      <th className="num">Savings balance</th><th className="num">Active plans</th>
                      {typed && <th>Last paid</th>}
                      <th>Status</th>{!typed && <th>Enrolled</th>}<th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(c => (
                      <tr key={c.id}>
                        <td>
                          <button type="button" className="cm-cell-btn" onClick={() => setDetail(c)} aria-label={`View ${c.name}`}>
                            <Avatar name={c.name} photoUrl={c.photoUrl} tone={c.status === 'Active' ? 'blue' : 'red'} />
                            <span>
                              <span className="td-name">{c.name}</span>
                              <span className="td-sub">{c.customerId}{c.type && <> · <TypeBadge type={c.type} /></>}</span>
                            </span>
                          </button>
                        </td>
                        <td data-label="Phone" className="cm-nowrap">{c.phone}</td>
                        <td data-label="Agent">
                          <div className="td-name">{c.agentName}</div>
                          <div className="td-sub">{c.agentId}</div>
                        </td>
                        <td className="num cm-strong" data-label="Savings balance">{naira(c.totalBalance)}</td>
                        <td className="num" data-label="Active plans">{c.activePlans}</td>
                        {typed && (
                          <td data-label="Last paid" className={`cm-nowrap${isOverdue(c) ? ' cm-late' : ' cm-sub2'}`}>{lastPaidText(c.lastPaidAt)}</td>
                        )}
                        <td data-label="Status"><StatusBadge status={c.status} /></td>
                        {!typed && <td data-label="Enrolled" className="cm-nowrap cm-sub2">{shortDate(c.createdAt)}</td>}
                        <td>
                          <div className="a-row-actions">
                            <button type="button" className="btn btn-sm btn-outline" onClick={() => setDetail(c)}>View</button>
                            {(c.status === 'Active' || c.status === 'Locked') && (
                              <button type="button" className={`btn btn-sm ${c.status === 'Active' ? 'btn-outline' : 'btn-soft'}`} onClick={() => askLock(c)}>
                                {c.status === 'Active' ? 'Lock' : 'Unlock'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={PAGE_SIZE} total={shown.length} onPage={setPage} />
            </>
          )}
      </section>

      {detail && (
        <Modal icon="customers" title={detail.name} sub={detail.customerId} onClose={() => setDetail(null)}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={() => setDetail(null)}>Close</button>
            <button type="button" className="btn btn-outline" onClick={() => { setSendCodeFor(detail); setDetail(null) }}>Send reset code</button>
            <button type="button" className="btn btn-outline" onClick={() => { setClearLockFor(detail); setDetail(null) }}>Clear sign-in lock</button>
            <button type="button" className="btn btn-outline" onClick={() => { setResetError(''); setResetDeviceFor(detail); setDetail(null) }}>Reset device</button>
            {(detail.status === 'Active' || detail.status === 'Locked') && (
              <button type="button" className={`btn ${detail.status === 'Active' ? 'btn-danger' : 'btn-green'}`} onClick={() => { const c = detail; setDetail(null); askLock(c) }}>
                {detail.status === 'Active' ? 'Lock account' : 'Unlock account'}
              </button>
            )}
          </>}>
          <div className="cm-detail-hd">
            <Avatar name={detail.name} photoUrl={detail.photoUrl} tone={detail.status === 'Active' ? 'blue' : 'red'} />
            <StatusBadge status={detail.status} />
            {detail.type && <TypeBadge type={detail.type} />}
          </div>

          <div className="cm-sec">
            <h3 className="cm-sec-title">Contact</h3>
            <dl className="dlg-ledger">
              <DlRow label="Phone">{detail.phone}</DlRow>
              <DlRow label="Email">{orDash(detail.email)}</DlRow>
              <DlRow label="Address">{orDash(detail.address)}</DlRow>
            </dl>
          </div>

          {hasProfileFields(detail) && (
            <div className="cm-sec">
              <h3 className="cm-sec-title">Profile</h3>
              <dl className="dlg-ledger">
                <DlRow label="Gender">{orNotRecorded(detail.gender)}</DlRow>
                <DlRow label="State">{orNotRecorded(detail.state)}</DlRow>
                <DlRow label="LGA">{orNotRecorded(detail.lga)}</DlRow>
              </dl>
            </div>
          )}

          <div className="cm-sec">
            <h3 className="cm-sec-title">Agent</h3>
            <dl className="dlg-ledger">
              <DlRow label="Name">{detail.agentName}</DlRow>
              <DlRow label="Agent ID">{detail.agentId}</DlRow>
            </dl>
          </div>

          <div className="cm-sec">
            <h3 className="cm-sec-title">Savings</h3>
            <dl className="dlg-ledger">
              <DlRow label="Total balance"><span className="cm-strong">{naira(detail.totalBalance)}</span></DlRow>
              <DlRow label="Active plans">{detail.activePlans}</DlRow>
              {detail.lastPaidAt !== undefined && (
                <DlRow label="Last paid">
                  <span className={isOverdue(detail) ? 'cm-late' : undefined}>
                    {detail.lastPaidAt ? `${lastPaidText(detail.lastPaidAt)} · ${shortDate(detail.lastPaidAt)}` : 'Never'}
                  </span>
                </DlRow>
              )}
              <DlRow label="Enrolled">{shortDate(detail.createdAt)}</DlRow>
            </dl>
          </div>
        </Modal>
      )}

      {lockTarget && (
        <ConfirmModal icon="locked"
          title={lockTarget.status === 'Active' ? `Lock ${lockTarget.name}?` : `Unlock ${lockTarget.name}?`}
          body={lockTarget.status === 'Active'
            ? <>{lockTarget.name} ({lockTarget.customerId}) won’t be able to sign in until you unlock them. Their {naira(lockTarget.totalBalance)} in savings stays as it is.</>
            : <>{lockTarget.name} ({lockTarget.customerId}) will be able to sign in again.</>}
          confirmLabel={lockTarget.status === 'Active' ? 'Lock account' : 'Unlock account'}
          danger={lockTarget.status === 'Active'}
          busy={lockBusy} error={lockError}
          onConfirm={toggleLock} onClose={() => setLockTarget(null)}
        />
      )}

      {resetDeviceFor && (
        <ConfirmModal icon="locked" title={`Reset ${resetDeviceFor.name}’s device?`}
          body={<>{resetDeviceFor.name} ({resetDeviceFor.customerId}) will be signed out on their current phone, and any fingerprint sign-in there stops working. They can then sign in with their password on a new phone, and that phone becomes their device. Their savings and password stay as they are.</>}
          confirmLabel="Reset device" busy={resetBusy} error={resetError}
          onConfirm={resetDevice} onClose={() => setResetDeviceFor(null)} />
      )}
      {toastNode}
      {clearLockFor && (
        <ClearSignInLockModal id={clearLockFor.id} name={clearLockFor.name} onClose={() => setClearLockFor(null)}
          onDone={msg => { setClearLockFor(null); toast(msg, 'success') }} />
      )}
      {sendCodeFor && (
        <SendResetCodeModal actorType="customer" id={sendCodeFor.id} name={sendCodeFor.name} onClose={() => setSendCodeFor(null)}
          onSent={msg => { setSendCodeFor(null); toast(msg, 'success') }} />
      )}
    </>
  )
}
