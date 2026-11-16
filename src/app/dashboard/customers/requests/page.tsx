'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
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
        <div><h1 className="ag-q">Requests</h1></div>
        {tab === 'customers' && (
          <div className="ag-head-actions">
            <Link href="/dashboard/enrol" className="ui-btn ui-btn--primary"><Icons.add size={18} aria-hidden="true" /> Enrol customer</Link>
          </div>
        )}
      </section>
      <div className="ui-segment ag-seg ag-tabs" role="group" aria-label="Request type">
        <button type="button" aria-pressed={tab === 'customers'} onClick={() => router.replace('/dashboard/customers/requests')}>Cash savers</button>
        <button type="button" aria-pressed={tab === 'agents'} onClick={() => router.replace('/dashboard/customers/requests?tab=agents')}>Upgrades</button>
      </div>
      {tab === 'agents' ? <AgentRequests /> : <CustomerRequests />}
    </div>
  )
}

function CustomerRequests() {
  const [requests, setRequests] = useState<Request[] | null>(null)
  const [failed, setFailed] = useState(false)

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
          <EmptyState icon="customers" title="No requests yet" text="Cash savers you enrol show here until the office approves them." />
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
                </>
              )}
            </li>
          ))}
        </ul>
      )}
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

  const load = useCallback(() => {
    setFailed(false)
    fetch('/api/agent-upgrade-requests')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: { requests: AgentRequest[] }) => setRequests(d.requests))
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => { load() }, [load])

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
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
