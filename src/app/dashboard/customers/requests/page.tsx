'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
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

export default function CustomerRequestsPage() {
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
    <div className="ag-page">
      <section className="ag-hello">
        <div><h1 className="ag-q">Customer requests</h1></div>
        <div className="ag-head-actions">
          <Link href="/dashboard/enrol" className="ui-btn ui-btn--primary"><Icons.add size={18} aria-hidden="true" /> Enrol customer</Link>
        </div>
      </section>

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
    </div>
  )
}
