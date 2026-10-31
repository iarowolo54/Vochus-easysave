'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Icons, type IconName } from '@/components/ui/icons'
import {
  Empty, LoadError, PageHeader, Pager, SearchField, Segmented, TableSkeleton, dateTime, useDebounced,
} from '../_components/admin-ui'

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

type ActionKey = '' | 'Saving' | 'Redemption' | 'Loan' | 'Enrolment' | 'Agent'

const ACTION_FILTERS: { value: ActionKey; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'Saving', label: 'Savings' },
  { value: 'Redemption', label: 'Redemptions' },
  { value: 'Loan', label: 'Loans' },
  { value: 'Enrolment', label: 'Enrolments' },
  { value: 'Agent', label: 'Agents' },
]

// Most specific first, so "loan_repayment" gets the repayment icon rather than the loan one.
const ACTION_ICON: [string, IconName][] = [
  ['repayment', 'repay'],
  ['disburse', 'cash'],
  ['saving', 'deposit'],
  ['redemption', 'redeem'],
  ['loan', 'loan'],
  ['enrol', 'enrol'],
  ['agent', 'customers'],
]

function iconFor(action: string): IconName {
  const key = action.toLowerCase()
  return ACTION_ICON.find(([k]) => key.includes(k))?.[1] ?? 'audit'
}

/** "loan_approve" → "Loan approve" */
function humanise(action: string) {
  const s = action.replace(/[_-]+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : action
}

const PAGE_SIZE = 30

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim())
  const [action, setAction] = useState<ActionKey>('')
  // null = the API didn't send a total (older server): page through what came back instead.
  const [total, setTotal] = useState<number | null>(null)
  // The page belongs to one search/filter; changing either starts again at page 1 without a second fetch.
  const filterKey = `${q}|${action}`
  const [paging, setPaging] = useState({ key: filterKey, page: 1 })
  const page = paging.key === filterKey ? paging.page : 1
  const setPage = (p: number) => setPaging({ key: filterKey, page: p })
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  const reqSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++reqSeq.current
    setLoading(true); setFailed(false)
    try {
      const params = new URLSearchParams()
      if (q) params.set('search', q)
      if (action) params.set('action', action)
      params.set('page', String(page))
      params.set('limit', String(PAGE_SIZE))
      const res = await fetch(`/api/admin/audit?${params}`)
      if (!res.ok) throw new Error()
      const d = await res.json() as { logs?: AuditLog[]; total?: number }
      if (seq !== reqSeq.current) return // a newer page/filter request superseded this one
      setLogs(d.logs ?? [])
      setTotal(typeof d.total === 'number' ? d.total : null)
      setLoaded(true)
    } catch {
      if (seq !== reqSeq.current) return
      setFailed(true)
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
  }, [q, action, page])

  useEffect(() => { load() }, [load])

  const count = total ?? logs.length
  const paginated = total === null ? logs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : logs
  const filtering = !!(q || action)

  return (
    <>
      <PageHeader
        title="Audit log"
        sub="A permanent record of what admins, agents and the system did. Entries can’t be edited or deleted."
        actions={<button type="button" className="btn btn-outline" onClick={load} disabled={loading}>
          <Icons.retry size={16} aria-hidden="true" /> {loading && loaded ? 'Refreshing…' : 'Refresh'}
        </button>}
      />

      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Action, name, ID or details" label="Search the audit log" />
        <Segmented<ActionKey> label="Filter by type" value={action} onChange={setAction} options={ACTION_FILTERS} />
      </div>

      <section className="card lo-audit" aria-label="Audit entries">
        {loading && !loaded ? <TableSkeleton rows={10} cols={4} />
          : failed ? <LoadError what="the audit log" onRetry={load} />
          : count === 0 ? (
            filtering
              ? <Empty icon="search" title="No entries match" text={q ? `Nothing found for “${q}”. Try a name, ID or a different type.` : 'Nothing of this type has been recorded yet.'} />
              : <Empty icon="audit" title="No entries yet" text="Actions like approving loans, saving and enrolling customers are recorded here." />
          ) : (
            <>
              <p className="lo-count" aria-live="polite">
                {`${count.toLocaleString('en-NG')} entr${count === 1 ? 'y' : 'ies'}${filtering ? ' match' : ''}`}
              </p>
              <ol className="rows">
                {paginated.map(log => {
                  const Icon = Icons[iconFor(log.action)]
                  return (
                    <li key={log.id} className="row">
                      <span className="row-ic" aria-hidden="true"><Icon size={18} /></span>
                      <div className="row-main">
                        <div className="row-title">{humanise(log.action)}</div>
                        <div className="row-sub">
                          {log.entity}{log.entityId ? ` · ${log.entityId}` : ''}
                          {log.details ? ` · ${log.details}` : ''}
                        </div>
                        {(log.actorName || log.actorId) && (
                          <div className="lo-audit-actor">By {log.actorName ?? log.actorId} ({log.actorType})</div>
                        )}
                      </div>
                      <time className="row-end" dateTime={log.createdAt}>{dateTime(log.createdAt)}</time>
                    </li>
                  )
                })}
              </ol>
              <Pager page={page} pageSize={PAGE_SIZE} total={count} onPage={setPage} />
            </>
          )}
      </section>
    </>
  )
}
