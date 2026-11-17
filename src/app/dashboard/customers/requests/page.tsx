'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import BottomSheet from '@/components/ui/BottomSheet'
import EmptyState from '@/components/ui/EmptyState'
import { Icons } from '@/components/ui/icons'
import { displayName } from '@/lib/format'

interface Request {
  id: string
  status: 'Pending' | 'Approved' | 'Denied'
  firstName: string
  lastName: string
  phone: string
  submittedAt: string
  decidedAt: string | null
  denyReason: string | null
  denyFix: string | null
  customerCode: string | null
}

const STATUS: Record<Request['status'], { label: string; cls: string }> = {
  Pending: { label: 'Waiting for approval', cls: 'ui-status--warn' },
  Approved: { label: 'Approved', cls: 'ui-status--success' },
  Denied: { label: 'Denied', cls: 'ui-status--danger' },
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export default function RequestsPage() {
  return <Suspense fallback={null}><RequestsTabs /></Suspense>
}

function RequestsTabs() {
  const params = useSearchParams()
  const router = useRouter()
  const tab = params.get('tab') === 'agents' ? 'agents' : 'customers'
  return (
    <div className="ag-page">
      <section className="ag-hello">
        <div><h1 className="ag-q">Sign-ups &amp; upgrades</h1></div>
        {tab === 'customers' && (
          <div className="ag-head-actions">
            <Link href="/dashboard/enrol" className="ui-btn ui-btn--primary"><Icons.add size={18} aria-hidden="true" /> Enrol customer</Link>
          </div>
        )}
      </section>
      <div className="ui-segment ag-seg ag-tabs" role="group" aria-label="Show">
        <button type="button" aria-pressed={tab === 'customers'} onClick={() => router.replace('/dashboard/customers/requests')}>Sign-ups</button>
        <button type="button" aria-pressed={tab === 'agents'} onClick={() => router.replace('/dashboard/customers/requests?tab=agents')}>Upgrades</button>
      </div>
      {tab === 'agents' ? <AgentRequests /> : <CustomerRequests />}
    </div>
  )
}

function CustomerRequests() {
  const [requests, setRequests] = useState<Request[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [cancelFor, setCancelFor] = useState<CancelTarget | null>(null)
  const openCancel = (r: Request) => setCancelFor({ id: r.id, name: `${r.firstName} ${r.lastName}`, waiting: r.status === 'Pending' })

  const load = useCallback(() => {
    setFailed(false)
    fetch('/api/customers/requests')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: { requests: Request[] }) => setRequests(d.requests))
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <>
      {failed ? (
        <section className="ui-card ag-flow-block">
          <EmptyState icon="error" title="Your requests couldn’t load" text="Check your internet and try again."
            action={<button type="button" className="ui-btn ui-btn--primary" onClick={load}>Try again</button>} />
        </section>
      ) : requests === null ? (
        <section className="ui-card ag-flow-block"><span className="ui-spinner" role="status" aria-label="Loading your requests" /></section>
      ) : requests.length === 0 ? (
        <section className="ui-card ag-flow-block">
          <EmptyState icon="customers" title="No sign-ups yet" text="Cash savers you enrol show here until the office approves them." />
        </section>
      ) : (
        <ul className="ag-creq-list">
          {requests.map(r => (
            <li key={r.id} className="ui-card ag-creq">
              <div className="ag-creq-head">
                <div className="ag-payee-main">
                  <p className="ui-row-title">{displayName(`${r.firstName} ${r.lastName}`)}</p>
                  <p className="ui-row-sub">{r.phone} · Sent {day(r.submittedAt)}</p>
                </div>
                <span className={`ui-status ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
              </div>
              {r.status === 'Approved' && r.customerCode && (
                <p className="ui-row-sub">Customer ID <strong className="ag-mono">{r.customerCode}</strong></p>
              )}
              {r.status === 'Denied' && (
                <>
                  <div className="ag-creq-why">
                    <p className="ui-row-sub">Why it was denied</p>
                    <p>{r.denyReason}</p>
                    <p className="ui-row-sub">What to work on</p>
                    <p>{r.denyFix}</p>
                  </div>
                  <Link href={`/dashboard/enrol?request=${encodeURIComponent(r.id)}`} className="ui-btn ui-btn--primary ui-btn--block">Fix and send again</Link>
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => openCancel(r)}>Cancel request</button>
                </>
              )}
              {r.status === 'Pending' && (
                <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => openCancel(r)}>Cancel request</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <CancelSheet target={cancelFor} endpoint="/api/customers/requests" onClose={() => setCancelFor(null)}
        onCancelled={id => { setRequests(list => list?.filter(x => x.id !== id) ?? list); load() }} />
    </>
  )
}

interface AgentRequest {
  id: string
  status: 'Pending' | 'Approved' | 'Denied'
  submittedAt: string
  denyReason: string | null
  denyFix: string | null
  newAgentCode: string | null
  /** After approval: how far the new agent is with their own documents. */
  documents: 'missing' | 'review' | 'rejected' | 'approved' | null
  customer: { firstName: string; lastName: string; customerId: string }
}

const AGENT_STATUS: Record<AgentRequest['status'], { label: string; cls: string }> = {
  Pending: { label: 'Under review', cls: 'ui-status--warn' },
  Approved: { label: 'Approved', cls: 'ui-status--success' },
  Denied: { label: 'Not approved', cls: 'ui-status--danger' },
}
const DOCS_TEXT: Record<NonNullable<AgentRequest['documents']>, string> = {
  missing: 'Waiting for them to upload their documents.',
  review: 'Their documents are being checked.',
  rejected: 'Some of their documents need a new file.',
  approved: 'Documents approved. They can work as an agent.',
}

function AgentRequests() {
  const [requests, setRequests] = useState<AgentRequest[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [cancelFor, setCancelFor] = useState<CancelTarget | null>(null)

  const load = useCallback(() => {
    setFailed(false)
    fetch('/api/agent-upgrade-requests')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: { requests: AgentRequest[] }) => setRequests(d.requests))
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => { load() }, [load])

  const openCancel = (r: AgentRequest) => setCancelFor({ id: r.id, name: `${r.customer.firstName} ${r.customer.lastName}`, waiting: r.status === 'Pending' })

  if (failed) return (
    <section className="ui-card ag-flow-block">
      <EmptyState icon="error" title="Your requests couldn’t load" text="Check your internet and try again."
        action={<button type="button" className="ui-btn ui-btn--primary" onClick={load}>Try again</button>} />
    </section>
  )
  if (requests === null) return <section className="ui-card ag-flow-block"><span className="ui-spinner" role="status" aria-label="Loading your requests" /></section>
  if (requests.length === 0) return (
    <section className="ui-card ag-flow-block">
      <EmptyState icon="customers" title="No upgrades yet" text="Open an online customer and tap Make agent." />
    </section>
  )
  return (
    <>
    <ul className="ag-creq-list">
      {requests.map(r => (
        <li key={r.id} className="ui-card ag-creq">
          <div className="ag-creq-head">
            <div className="ag-payee-main">
              <p className="ui-row-title">{displayName(`${r.customer.firstName} ${r.customer.lastName}`)}</p>
              <p className="ui-row-sub">{r.customer.customerId} · Sent {day(r.submittedAt)}</p>
            </div>
            <span className={`ui-status ${AGENT_STATUS[r.status].cls}`}>{AGENT_STATUS[r.status].label}</span>
          </div>
          {r.status === 'Approved' && r.newAgentCode && (
            <p className="ui-row-sub">Agent ID <strong className="ag-mono">{r.newAgentCode}</strong>{r.documents ? ` · ${DOCS_TEXT[r.documents]}` : ''}</p>
          )}
          {r.status === 'Denied' && (
            <>
              <div className="ag-creq-why">
                <p className="ui-row-sub">Why it wasn’t approved</p>
                <p>{r.denyReason}</p>
                <p className="ui-row-sub">What to work on</p>
                <p>{r.denyFix}</p>
              </div>
              <Link href={`/dashboard/make-agent?request=${encodeURIComponent(r.id)}`} className="ui-btn ui-btn--primary ui-btn--block">Fix and send again</Link>
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => openCancel(r)}>Cancel request</button>
            </>
          )}
          {r.status === 'Pending' && (
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => openCancel(r)}>Cancel request</button>
          )}
        </li>
      ))}
    </ul>
    <CancelSheet target={cancelFor} endpoint="/api/agent-upgrade-requests" onClose={() => setCancelFor(null)}
      onCancelled={id => { setRequests(list => list?.filter(x => x.id !== id) ?? list); load() }} />
    </>
  )
}

type CancelTarget = { id: string; name: string; waiting: boolean }

/** Confirm before an agent drops one of their own requests (waiting or not approved). */
function CancelSheet({ target, endpoint, onClose, onCancelled }: { target: CancelTarget | null; endpoint: string; onClose: () => void; onCancelled: (id: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setError('') }, [target])

  const cancel = async () => {
    if (!target) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${endpoint}/${encodeURIComponent(target.id)}`, { method: 'DELETE' })
      const d: { error?: string } = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? 'It couldn’t be cancelled. Try again.'); return }
      onCancelled(target.id)
      onClose()
    } catch {
      setError('Check your internet and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={!!target} onClose={() => { if (!busy) onClose() }} title="Cancel this request?">
      {target && (
        <>
          <p className="ui-note">The request for {displayName(target.name)} will be removed{target.waiting ? ' and the office won’t review it' : ''}. You can send a new request later.</p>
          {error && <p className="ag-set-note ag-set-note--warn" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}
          <div className="ui-stack">
            <button type="button" className="ui-btn ui-btn--danger ui-btn--block" disabled={busy} onClick={cancel}>
              {busy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Cancelling…</> : 'Cancel request'}
            </button>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={busy} onClick={onClose}>Keep it</button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}
