'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ConfirmModal, Empty, Field, Ledger, LedgerRow, LoadError, Modal, PageHeader, Pager, SearchField, Segmented, TableSkeleton,
  dateTime, naira, nairaKobo, shortDate, useDebounced, useToast,
} from '../_components/admin-ui'
import NoAccess from '../_components/NoAccess'

type Status = 'Pending' | 'Approved' | 'Denied'
type Filter = Status | 'all'

interface Row {
  id: string; status: Status; firstName: string; lastName: string; phone: string; lga: string; state: string
  planCount: number; submittedAt: string; decidedAt: string | null; decidedBy: string | null; customerCode: string | null
  agent: { name: string; agentId: string }
}
interface Page { rows: Row[]; total: number; page: number; pageSize: number; counts: Partial<Record<Status, number>>; canManage: boolean }
interface Plan { dailyAmount: number; periodDays: number; goal: string; cadence: string; startDate: string; endDate: string | null; notes: string | null }
interface Detail extends Omit<Row, 'planCount' | 'agent'> {
  email: string | null; dob: string | null; address: string; language: string; gender: string; nokName: string; nokRelation: string; nokPhone: string
  photoUrl: string | null; nfcCard: string | null; registrationFee: number; denyReason: string | null; denyFix: string | null; plans: Plan[]; bvnLast4: string | null
  agent: { name: string; agentId: string; walletBalance: number }
}

const BADGE: Record<Status, string> = { Pending: 'bdg-a', Approved: 'bdg-g', Denied: 'bdg-r' }
const LABEL: Record<Status, string> = { Pending: 'Waiting', Approved: 'Approved', Denied: 'Denied' }

function planSummary(p: Plan) {
  if (p.cadence === 'flexible') return `Flexible, any amount, ends ${shortDate(p.endDate ?? p.startDate)}`
  const per = p.cadence === 'weekly' ? { n: 7, w: 'week' } : p.cadence === 'monthly' ? { n: 30, w: 'month' } : { n: 1, w: 'day' }
  return `${naira(p.dailyAmount * per.n)} a ${per.w} for ${p.periodDays} days, from ${shortDate(p.startDate)}`
}

async function errorText(res: Response, fallback: string) {
  const d = await res.json().catch(() => null) as { error?: string } | null
  return d?.error || fallback
}

export default function CustomerRequestsPage() {
  const [tab, setTab] = useState<'registrations' | 'photos'>('registrations')
  return (
    <>
      <PageHeader title="Customer requests" sub={tab === 'photos'
        ? 'Photos agents took of existing customers. Approve only a clear photo of the customer’s face.'
        : 'Cash savers agents want to register. Check that each photo is a real passport photograph before approving.'} />
      <div className="toolbar bt-toolbar">
        <Segmented label="Requests" value={tab} options={[{ value: 'registrations', label: 'Registrations' }, { value: 'photos', label: 'Photos' }]} onChange={setTab} />
      </div>
      {tab === 'photos' ? <PhotoRequests /> : <RegistrationRequests />}
    </>
  )
}

function RegistrationRequests() {
  const [data, setData] = useState<Page | null>(null)
  const [filter, setFilter] = useState<Filter>('Pending')
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim())
  const key = `${filter}|${q}`
  const [paging, setPaging] = useState({ key, page: 1 })
  const page = paging.key === key ? paging.page : 1
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<'error' | 'forbidden' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [toastNode, toast] = useToast()

  const seq = useRef(0)
  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true); setFailed(null)
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (filter !== 'all') params.set('status', filter)
      if (q) params.set('q', q)
      const res = await fetch(`/api/admin/customer-requests?${params}`)
      if (res.status === 401 || res.status === 403) { if (mine === seq.current) setFailed('forbidden'); return }
      if (!res.ok) throw new Error()
      const d = await res.json() as Page
      if (mine === seq.current) setData(d)
    } catch {
      if (mine === seq.current) setFailed('error')
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [filter, q, page])

  useEffect(() => { load() }, [load])

  if (failed === 'forbidden') return <NoAccess area="customer requests" />

  const counts = data?.counts
  const options: { value: Filter; label: string; count?: number }[] = [
    { value: 'Pending', label: 'Waiting', count: counts?.Pending ?? 0 },
    { value: 'Denied', label: 'Denied', count: counts?.Denied ?? 0 },
    { value: 'Approved', label: 'Approved', count: counts?.Approved ?? 0 },
    { value: 'all', label: 'All' },
  ]

  return (
    <>
      <div className="toolbar bt-toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Customer, phone or agent" label="Search customer requests" />
        <Segmented label="Status" value={filter} options={options} onChange={setFilter} />
      </div>

      <section className="card" aria-label="Customer requests" aria-busy={loading}>
        {loading && !data ? <TableSkeleton rows={6} cols={4} />
          : failed || !data ? <LoadError what="customer requests" onRetry={load} />
          : data.total === 0 ? (
            q
              ? <Empty icon="search" title="Nothing matches" text="Try another name, or clear the search."
                  action={<button type="button" className="btn btn-outline" onClick={() => setSearch('')}>Clear search</button>} />
              : <Empty icon="customers" title={filter === 'Pending' ? 'Nothing waiting' : 'No requests here'} text="Requests show here when agents enrol cash savers." />
          ) : (
            <>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead><tr><th>Sent</th><th>Customer</th><th>Agent</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.rows.map(r => (
                      <tr key={r.id} className="bt-row" onClick={() => setOpenId(r.id)}>
                        <td data-label="Sent" className="cm-nowrap cm-sub2">
                          <button type="button" className="cm-cell-btn" aria-label={`Open the request for ${r.firstName} ${r.lastName}`}
                            onClick={e => { e.stopPropagation(); setOpenId(r.id) }}>{dateTime(r.submittedAt)}</button>
                        </td>
                        <td data-label="Customer">
                          <div className="td-name">{r.firstName} {r.lastName}</div>
                          <div className="td-sub">{r.phone} · {r.lga}, {r.state}</div>
                        </td>
                        <td data-label="Agent">
                          <div className="td-name">{r.agent.name}</div>
                          <div className="td-sub">{r.agent.agentId}</div>
                        </td>
                        <td data-label="Status">
                          <span className={`bdg ${BADGE[r.status]}`}>{LABEL[r.status]}</span>
                          {r.customerCode && <div className="td-sub">{r.customerCode}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={p => setPaging({ key, page: p })} />
            </>
          )}
      </section>

      {openId && (
        <RequestDialog id={openId} canManage={!!data?.canManage} onClose={() => setOpenId(null)}
          onDone={msg => { setOpenId(null); toast(msg, 'success'); load() }} />
      )}
      {toastNode}
    </>
  )
}

function RequestDialog({ id, canManage, onClose, onDone }: { id: string; canManage: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [r, setR] = useState<Detail | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [mode, setMode] = useState<'view' | 'approve' | 'deny'>('view')
  const [reason, setReason] = useState('')
  const [fix, setFix] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoadFailed(false)
    fetch(`/api/admin/customer-requests/${encodeURIComponent(id)}`)
      .then(res => { if (!res.ok) throw new Error(); return res.json() })
      .then(setR)
      .catch(() => setLoadFailed(true))
  }, [id])
  useEffect(() => { load() }, [load])

  async function decide(action: 'approve' | 'deny') {
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/admin/customer-requests/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'deny' ? JSON.stringify({ reason, fix }) : '{}',
      })
      if (!res.ok) { setError(await errorText(res, 'That didn’t work. Please try again.')); return }
      const d = await res.json() as { customerCode?: string; cardNotLinked?: boolean }
      onDone(action === 'approve'
        ? `Approved as ${d.customerCode}.${d.cardNotLinked ? ' The card couldn’t be linked; the agent can link another.' : ''}`
        : 'Request denied. The agent has been told.')
    } catch {
      setError('No connection. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!r) {
    return (
      <Modal title="Customer request" onClose={onClose}>
        {loadFailed ? <LoadError what="this request" onRetry={load} /> : <TableSkeleton rows={4} cols={2} />}
      </Modal>
    )
  }

  const name = `${r.firstName} ${r.lastName}`
  const pending = r.status === 'Pending' && canManage
  const short = r.agent.walletBalance < r.registrationFee

  if (mode === 'approve') {
    return (
      <ConfirmModal title={`Approve ${name}?`} confirmLabel="Approve" busy={busy} error={error}
        body={<>This creates the account and takes {naira(r.registrationFee)} from {r.agent.name}’s wallet. Their balance is {nairaKobo(r.agent.walletBalance)}.</>}
        onConfirm={() => decide('approve')} onClose={() => { setMode('view'); setError('') }} />
    )
  }

  if (mode === 'deny') {
    const ready = reason.trim().length >= 3 && fix.trim().length >= 3
    return (
      <Modal title={`Deny ${name}`} sub="The agent sees both of these and can send the request again." tone="danger" icon="error" busy={busy} error={error}
        onClose={onClose} onBack={() => { setMode('view'); setError('') }}
        footer={<button type="button" className="btn btn-danger" disabled={busy || !ready} onClick={() => decide('deny')}>{busy ? 'Denying…' : 'Deny request'}</button>}>
        <Field id="cr-reason" label="Reason">
          <textarea id="cr-reason" rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
        <Field id="cr-fix" label="What to work on">
          <textarea id="cr-fix" rows={3} maxLength={500} value={fix} onChange={e => setFix(e.target.value)} />
        </Field>
      </Modal>
    )
  }

  return (
    <Modal title={name} sub={`From ${r.agent.name} (${r.agent.agentId}) · ${dateTime(r.submittedAt)}`} size="lg" onClose={onClose}
      footnote={pending && short ? `The wallet is short of the ${naira(r.registrationFee)} fee.` : undefined}
      footer={pending ? (
        <>
          <button type="button" className="btn btn-outline" onClick={() => setMode('deny')}>Deny</button>
          <button type="button" className="btn btn-primary" onClick={() => setMode('approve')}>Approve</button>
        </>
      ) : undefined}>
      <div className="cr-review">
        <div className="cr-photo">
          {r.photoUrl
            ? <a href={r.photoUrl} target="_blank" rel="noreferrer" aria-label="Open the photo full size"><img src={r.photoUrl} alt={`Uploaded for ${name}`} /></a>
            : <p className="cm-muted">{r.status === 'Approved' ? 'The photo is now on the customer’s account.' : 'No photo'}</p>}
        </div>
        <div className="cr-facts">
          {r.status === 'Denied' && (
            <Ledger title="Denied">
              <LedgerRow label="Reason">{r.denyReason}</LedgerRow>
              <LedgerRow label="To work on">{r.denyFix}</LedgerRow>
            </Ledger>
          )}
          {r.status !== 'Pending' && r.decidedAt && (
            <Ledger title="Decision">
              <LedgerRow label="By">{r.decidedBy}</LedgerRow>
              <LedgerRow label="When">{dateTime(r.decidedAt)}</LedgerRow>
              {r.customerCode && <LedgerRow label="Customer ID">{r.customerCode}</LedgerRow>}
            </Ledger>
          )}
          <Ledger title="Customer">
            <LedgerRow label="Phone">{r.phone}</LedgerRow>
            {r.email && <LedgerRow label="Email">{r.email}</LedgerRow>}
            <LedgerRow label="Gender">{r.gender}</LedgerRow>
            {r.dob && <LedgerRow label="Date of birth">{shortDate(r.dob)}</LedgerRow>}
            <LedgerRow label="Address">{r.address}, {r.lga}, {r.state}</LedgerRow>
            <LedgerRow label="Language">{r.language}</LedgerRow>
            {r.bvnLast4 && <LedgerRow label="BVN">•••• {r.bvnLast4}</LedgerRow>}
            {r.nokName && <LedgerRow label="Next of kin">{r.nokName} ({r.nokRelation}){r.nokPhone ? `, ${r.nokPhone}` : ''}</LedgerRow>}
          </Ledger>
          <Ledger title={r.plans.length > 1 ? `Savings plans (${r.plans.length})` : 'Savings plan'}>
            {r.plans.map((p, i) => <LedgerRow key={i} label={p.goal}>{planSummary(p)}</LedgerRow>)}
          </Ledger>
          <Ledger title="Card and fee">
            <LedgerRow label="Card">{r.nfcCard || 'Link later'}</LedgerRow>
            <LedgerRow label="Registration fee">{naira(r.registrationFee)}</LedgerRow>
            {r.status === 'Pending' && <LedgerRow label="Agent wallet">{nairaKobo(r.agent.walletBalance)}</LedgerRow>}
          </Ledger>
        </div>
      </div>
    </Modal>
  )
}

type PhotoStatusName = 'Pending' | 'Approved' | 'Rejected'
const PHOTO_BADGE: Record<PhotoStatusName, string> = { Pending: 'bdg-a', Approved: 'bdg-g', Rejected: 'bdg-r' }
const PHOTO_LABEL: Record<PhotoStatusName, string> = { Pending: 'Waiting', Approved: 'Approved', Rejected: 'Rejected' }
interface PhotoRow {
  id: string; status: PhotoStatusName; rejectReason: string | null; submittedAt: string; decidedAt: string | null; decidedBy: string | null
  customer: { id: string; firstName: string; lastName: string; customerId: string }; agent: { name: string; agentId: string }
}
interface PhotoDetail extends Omit<PhotoRow, 'customer'> {
  photoUrl: string | null; currentPhotoHref: string | null
  customer: { id: string; firstName: string; lastName: string; customerId: string; phone: string; type: string }
}

/** Photos agents took of existing customers (photo deadline), waiting first. */
function PhotoRequests() {
  const [data, setData] = useState<{ photos: PhotoRow[]; canManage: boolean } | null>(null)
  const [failed, setFailed] = useState<'error' | 'forbidden' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [toastNode, toast] = useToast()

  const load = useCallback(async () => {
    setFailed(null)
    try {
      const res = await fetch('/api/admin/customer-photos', { cache: 'no-store' })
      if (res.status === 401 || res.status === 403) { setFailed('forbidden'); return }
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch { setFailed('error') }
  }, [])
  useEffect(() => { load() }, [load])

  if (failed === 'forbidden') return <NoAccess area="customer requests" />
  return (
    <>
      <section className="card" aria-label="Customer photos" aria-busy={!data && !failed}>
        {!data && !failed ? <TableSkeleton rows={6} cols={4} />
          : failed || !data ? <LoadError what="customer photos" onRetry={load} />
          : data.photos.length === 0 ? <Empty icon="customers" title="No photos waiting" text="Photos show here when agents take one of a customer." />
          : (
            <div className="tbl-wrap tbl-stack">
              <table>
                <thead><tr><th>Sent</th><th>Customer</th><th>Agent</th><th>Status</th></tr></thead>
                <tbody>
                  {data.photos.map(r => (
                    <tr key={r.id} className="bt-row" onClick={() => setOpenId(r.id)}>
                      <td data-label="Sent" className="cm-nowrap cm-sub2">
                        <button type="button" className="cm-cell-btn" aria-label={`Open the photo of ${r.customer.firstName} ${r.customer.lastName}`}
                          onClick={e => { e.stopPropagation(); setOpenId(r.id) }}>{dateTime(r.submittedAt)}</button>
                      </td>
                      <td data-label="Customer"><div className="td-name">{r.customer.firstName} {r.customer.lastName}</div><div className="td-sub">{r.customer.customerId}</div></td>
                      <td data-label="Agent"><div className="td-name">{r.agent.name}</div><div className="td-sub">{r.agent.agentId}</div></td>
                      <td data-label="Status"><span className={`bdg ${PHOTO_BADGE[r.status]}`}>{PHOTO_LABEL[r.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
      {openId && <PhotoDialog id={openId} canManage={!!data?.canManage} onClose={() => setOpenId(null)} onDone={msg => { setOpenId(null); toast(msg, 'success'); load() }} />}
      {toastNode}
    </>
  )
}

function PhotoDialog({ id, canManage, onClose, onDone }: { id: string; canManage: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [r, setR] = useState<PhotoDetail | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [mode, setMode] = useState<'view' | 'approve' | 'reject'>('view')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [currentBroken, setCurrentBroken] = useState(false)

  const load = useCallback(() => {
    setLoadFailed(false)
    fetch(`/api/admin/customer-photos/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(res => { if (!res.ok) throw new Error(); return res.json() })
      .then(setR)
      .catch(() => setLoadFailed(true))
  }, [id])
  useEffect(() => { load() }, [load])

  async function decide(action: 'approve' | 'reject') {
    if (!r) return
    setBusy(true); setError('')
    try {
      // seenSubmittedAt: the decision only applies to this exact photo, not a newer one sent while it was open.
      const res = await fetch(`/api/admin/customer-photos/${encodeURIComponent(id)}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'reject' ? { reason, seenSubmittedAt: r.submittedAt } : { seenSubmittedAt: r.submittedAt }),
      })
      if (!res.ok) { setError(await errorText(res, 'That didn’t work. Please try again.')); return }
      onDone(action === 'approve' ? 'Photo approved. Saving for this customer works again.' : 'Photo rejected. The agent has been told.')
    } catch {
      setError('No connection. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!r) {
    return <Modal title="Customer photo" onClose={onClose}>{loadFailed ? <LoadError what="this photo" onRetry={load} /> : <TableSkeleton rows={4} cols={2} />}</Modal>
  }
  const name = `${r.customer.firstName} ${r.customer.lastName}`
  const pending = r.status === 'Pending' && canManage

  if (mode === 'approve') {
    return <ConfirmModal title={`Approve this photo of ${name}?`} confirmLabel="Approve" busy={busy} error={error}
      body={<>It goes onto {name}’s account{r.currentPhotoHref ? ', replacing their current photo' : ''}.</>}
      onConfirm={() => decide('approve')} onClose={() => { setMode('view'); setError('') }} />
  }
  if (mode === 'reject') {
    const ready = reason.trim().length >= 3
    return (
      <Modal title={`Reject the photo of ${name}`} sub="The agent sees this and takes a new photo." tone="danger" icon="error" busy={busy} error={error}
        onClose={onClose} onBack={() => { setMode('view'); setError('') }}
        footer={<button type="button" className="btn btn-danger" disabled={busy || !ready} onClick={() => decide('reject')}>{busy ? 'Rejecting…' : 'Reject photo'}</button>}>
        <Field id="cp-reason" label="What’s wrong with the photo?">
          <textarea id="cp-reason" rows={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
      </Modal>
    )
  }
  return (
    <Modal title={name} sub={`From ${r.agent.name} (${r.agent.agentId}) · ${dateTime(r.submittedAt)}`} size="lg" onClose={onClose}
      footer={pending ? (
        <>
          <button type="button" className="btn btn-outline" onClick={() => setMode('reject')}>Reject</button>
          <button type="button" className="btn btn-primary" onClick={() => setMode('approve')}>Approve</button>
        </>
      ) : undefined}>
      <div className="cp-compare">
        <figure className="cr-photo">
          {r.photoUrl
            ? <a href={r.photoUrl} target="_blank" rel="noreferrer" aria-label="Open the new photo full size"><img src={r.photoUrl} alt={`New photo of ${name}`} /></a>
            : <p className="cm-muted">{r.status === 'Approved' ? 'This photo is now on the customer’s account.' : 'Not kept after the decision.'}</p>}
          <figcaption className="td-sub">New photo</figcaption>
        </figure>
        <figure className="cr-photo">
          {r.currentPhotoHref && !currentBroken
            ? <img src={r.currentPhotoHref} alt={`Current photo of ${name}`} onError={() => setCurrentBroken(true)} />
            : <p className="cm-muted">No photo yet</p>}
          <figcaption className="td-sub">Current photo</figcaption>
        </figure>
      </div>
      <Ledger title="Customer">
        <LedgerRow label="Customer ID">{r.customer.customerId}</LedgerRow>
        <LedgerRow label="Phone">{r.customer.phone}</LedgerRow>
        <LedgerRow label="Type">{r.customer.type === 'online' ? 'Online' : 'Offline'}</LedgerRow>
      </Ledger>
      {r.status !== 'Pending' && r.decidedAt && (
        <Ledger title={r.status === 'Rejected' ? 'Rejected' : 'Decision'}>
          {r.rejectReason && <LedgerRow label="Reason">{r.rejectReason}</LedgerRow>}
          <LedgerRow label="By">{r.decidedBy}</LedgerRow>
          <LedgerRow label="When">{dateTime(r.decidedAt)}</LedgerRow>
        </Ledger>
      )}
    </Modal>
  )
}
