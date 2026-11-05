'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  AmountHero, Empty, Field, Ledger, LedgerRow, LoadError, Modal, PageHeader, Pager, SearchField, Segmented, TableSkeleton,
  dateTime, nairaKobo, useDebounced, useToast,
} from '../_components/admin-ui'
import NoAccess from '../_components/NoAccess'

type Status = 'paid' | 'waiting' | 'not-paid' | 'needs-review' | 'by-hand'
type Filter = 'all' | Status

interface Row {
  kind: 'request' | 'alert'
  id: string
  ref: string
  at: string
  who: { type: 'customer' | 'agent'; name: string; code: string } | null
  plan: string | null
  amount: number
  status: Status
  statusLabel: string
  detail: string | null
  actionable: boolean
}
interface Page {
  rows: Row[]
  total: number
  page: number
  pageSize: number
  counts: Record<Filter, number>
  truncated: boolean
  canManage: boolean
}
interface Person { id: string; code: string; name: string; plans: { id: string; goal: string; balance: number }[] }

const BADGE: Record<Status, string> = {
  paid: 'bdg-g', waiting: 'bdg-b', 'not-paid': 'bdg-grey', 'needs-review': 'bdg-a', 'by-hand': 'bdg-p',
}
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs-review', label: 'Needs review' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'not-paid', label: 'Not paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'by-hand', label: 'Credited by hand' },
]

type Dialog =
  | { type: 'request'; row: Row }
  | { type: 'alert'; row: Row }
  | { type: 'dismiss'; row: Row }

export default function BankTransfersPage() {
  const [data, setData] = useState<Page | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim())
  const filterKey = `${filter}|${q}`
  const [paging, setPaging] = useState({ key: filterKey, page: 1 })
  const page = paging.key === filterKey ? paging.page : 1
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<'error' | 'forbidden' | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [toastNode, toast] = useToast()

  const seq = useRef(0)
  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true); setFailed(null)
    try {
      const params = new URLSearchParams({ status: filter, page: String(page) })
      if (q) params.set('q', q)
      const res = await fetch(`/api/admin/bank-transfers?${params}`)
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

  if (failed === 'forbidden') return <NoAccess area="bank transfers" />

  const counts = data?.counts
  const options = FILTERS.map(f => ({ ...f, count: f.value === 'all' || !counts ? undefined : counts[f.value] }))
  const filtered = filter !== 'all' || !!q

  return (
    <>
      <PageHeader title="Bank transfers" sub="Money that customers and agents send to the Moniepoint account. Credit a payment by hand if it didn’t arrive on its own." />

      {counts && counts['needs-review'] > 0 && (
        <div className="a-alert a-alert-a" role="status">
          {counts['needs-review']} payment{counts['needs-review'] === 1 ? ' needs' : 's need'} a look. The money reached the bank but couldn’t be credited on its own.
        </div>
      )}

      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Name, ID, plan or amount" label="Search bank transfers" />
        <Segmented label="Status" value={filter} options={options} onChange={setFilter} />
      </div>

      <section className="card" aria-label="Bank transfers" aria-busy={loading}>
        {loading && !data ? <TableSkeleton rows={8} cols={6} />
          : failed || !data ? <LoadError what="bank transfers" onRetry={load} />
          : data.total === 0 ? (
            filtered
              ? <Empty icon="search" title="Nothing matches" text="Try another status or clear the search."
                  action={<button type="button" className="btn btn-outline" onClick={() => { setFilter('all'); setSearch('') }}>Clear filters</button>} />
              : <Empty icon="deposit" title="No bank transfers yet" text="Transfers show here as customers and agents start them." />
          ) : (
            <>
              <p className="cm-count">{data.total.toLocaleString('en-NG')} transfer{data.total === 1 ? '' : 's'}{data.truncated ? ' · latest 300 shown' : ''}</p>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr><th>When</th><th>Who</th><th>For</th><th className="num">Amount</th><th>Status</th><th className="td-pin-end"><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {data.rows.map(r => (
                      <tr key={`${r.kind}-${r.id}`}>
                        <td data-label="When" className="cm-nowrap cm-sub2">{dateTime(r.at)}</td>
                        <td data-label="Who">
                          {r.who ? (<><div className="td-name">{r.who.name}</div><div className="td-sub">{r.who.type === 'agent' ? 'Agent' : 'Customer'} · {r.who.code}</div></>)
                            : <span className="cm-muted">{r.kind === 'alert' ? 'Unknown sender' : '—'}</span>}
                        </td>
                        <td data-label="For" className="cm-sub2">{r.who?.type === 'agent' ? 'Wallet top-up' : r.plan ?? (r.kind === 'alert' ? '—' : 'Savings')}</td>
                        <td data-label="Amount" className="num cm-strong">{nairaKobo(r.amount)}</td>
                        <td data-label="Status">
                          <span className={`bdg ${BADGE[r.status]}`}>{r.statusLabel}</span>
                          {r.detail && <div className="td-sub">{r.detail}</div>}
                        </td>
                        <td className="td-pin-end">
                          {data.canManage && r.actionable && (
                            r.kind === 'request'
                              ? <button type="button" className="btn btn-outline btn-sm" onClick={() => setDialog({ type: 'request', row: r })}>Credit by hand</button>
                              : <>
                                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setDialog({ type: 'alert', row: r })}>Credit to…</button>{' '}
                                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setDialog({ type: 'dismiss', row: r })}>Dismiss</button>
                                </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={p => setPaging({ key: filterKey, page: p })} />
            </>
          )}
      </section>

      {dialog && (
        <ActionDialog
          dialog={dialog}
          onClose={() => setDialog(null)}
          onDone={(msg) => { setDialog(null); toast(msg, 'success'); load() }}
        />
      )}
      {toastNode}
    </>
  )
}

function ActionDialog({ dialog, onClose, onDone }: { dialog: Dialog; onClose: () => void; onDone: (msg: string) => void }) {
  const { row } = dialog
  const [note, setNote] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // "Credit to…" only: who gets the money.
  const [kind, setKind] = useState<'customer' | 'agent'>('customer')
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim())
  const [people, setPeople] = useState<Person[]>([])
  const [person, setPerson] = useState<Person | null>(null)
  const [planId, setPlanId] = useState('')

  useEffect(() => {
    if (dialog.type !== 'alert' || q.length < 2) { setPeople([]); return }
    let live = true
    fetch(`/api/admin/bank-transfers/people?kind=${kind}&q=${encodeURIComponent(q)}`)
      .then(r => r.ok ? r.json() : { people: [] })
      .then((d: { people?: Person[] }) => { if (live) setPeople(d.people ?? []) })
      .catch(() => { if (live) setPeople([]) })
    return () => { live = false }
  }, [dialog.type, kind, q])

  const title = dialog.type === 'request' ? 'Credit this payment by hand?'
    : dialog.type === 'alert' ? 'Credit this money to someone' : 'Dismiss this payment?'
  const sub = dialog.type === 'request'
    ? 'Only do this after you have seen the money in the Moniepoint account. It is credited at the amount shown.'
    : dialog.type === 'alert'
      ? 'Choose who the money belongs to. It is credited at the amount that arrived.'
      : 'Use this when the money is not from a customer or agent, or was already credited by hand. Nothing is credited.'

  const needsTarget = dialog.type === 'alert'
  const targetOk = !needsTarget || (kind === 'agent' ? !!person : !!person && !!planId)
  const ready = targetOk && note.trim().length >= 3 && pin.length > 0

  async function submit() {
    if (!ready) return
    setBusy(true); setError('')
    const [url, body] =
      dialog.type === 'request' ? ['credit-request', { ref: row.ref }] as const
      : dialog.type === 'dismiss' ? ['dismiss-alert', { alertId: row.id }] as const
      : ['credit-alert', { alertId: row.id, target: kind === 'agent' ? { kind, agentId: person?.id } : { kind, customerId: person?.id, planId } }] as const
    try {
      const res = await fetch(`/api/admin/bank-transfers/${url}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, note: note.trim(), pin }),
      })
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!res.ok || !d.ok) { setError(d.error ?? 'That didn’t go through. Nothing was changed.'); return }
      onDone(dialog.type === 'dismiss' ? 'Dismissed.' : `${nairaKobo(row.amount)} credited.`)
    } catch {
      setError('No connection. Check your internet and try again. Nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} sub={sub} icon="deposit" tone={dialog.type === 'dismiss' ? 'neutral' : 'money'} onClose={onClose} busy={busy} error={error || undefined}
      footnote="Recorded in the audit log"
      footer={<>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-green" disabled={busy || !ready} aria-busy={busy} onClick={submit}>
          {busy ? 'Working…' : dialog.type === 'dismiss' ? 'Dismiss' : `Credit ${nairaKobo(row.amount)}`}
        </button>
      </>}>
      <AmountHero label={dialog.type === 'dismiss' ? 'Held payment' : 'You’re crediting'} amount={nairaKobo(row.amount)}
        sub={row.who ? <>for <strong>{row.who.name}</strong> · {row.who.code}</> : row.detail} />

      {dialog.type === 'alert' && (
        <>
          <Segmented label="Credit to" value={kind} options={[{ value: 'customer', label: 'A customer' }, { value: 'agent', label: 'An agent wallet' }]}
            onChange={k => { setKind(k); setPerson(null); setPlanId(''); setSearch('') }} />
          {!person ? (
            <Field id="bt-find" label={kind === 'agent' ? 'Find the agent' : 'Find the customer'} hint="Type a name or ID.">
              <input id="bt-find" className="a-input" type="text" autoComplete="off" maxLength={60} value={search} onChange={e => setSearch(e.target.value)} />
            </Field>
          ) : null}
          {!person && people.length > 0 && (
            <ul aria-label="Matches" style={{ listStyle: 'none', padding: 0, margin: '8px 0', display: 'grid', gap: 8 }}>
              {people.map(p => (
                <li key={p.id}>
                  <button type="button" className="btn btn-outline btn-block" onClick={() => { setPerson(p); setPlanId(p.plans.length === 1 ? p.plans[0].id : '') }}>
                    {p.name} · {p.code}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!person && q.length >= 2 && people.length === 0 && <p className="a-hint">No match yet.</p>}
          {person && (
            <Ledger>
              <LedgerRow label={kind === 'agent' ? 'Agent' : 'Customer'}>{person.name} · {person.code}</LedgerRow>
              {kind === 'customer' && (
                <LedgerRow label="Savings plan">
                  {person.plans.length === 0 ? 'No active plan. Choose someone else.' : (
                    <select className="a-input" aria-label="Savings plan" value={planId} onChange={e => setPlanId(e.target.value)}>
                      <option value="">Choose a plan</option>
                      {person.plans.map(pl => <option key={pl.id} value={pl.id}>{pl.goal} · balance {nairaKobo(pl.balance)}</option>)}
                    </select>
                  )}
                </LedgerRow>
              )}
              <LedgerRow label=""><button type="button" className="ui-link" onClick={() => { setPerson(null); setPlanId('') }}>Choose someone else</button></LedgerRow>
            </Ledger>
          )}
        </>
      )}

      <form onSubmit={e => { e.preventDefault(); submit() }} noValidate>
        <Field id="bt-note" label="Why? (required)" hint="For example the bank reference, or what the sender told you.">
          <input id="bt-note" className="a-input" type="text" maxLength={300} autoComplete="off" value={note} onChange={e => { setNote(e.target.value); setError('') }} />
        </Field>
        <Field id="bt-pin" label="Approval PIN">
          <input id="bt-pin" className="a-input am-pin" type="password" inputMode="numeric" maxLength={6} autoComplete="off" placeholder="••••"
            value={pin} onChange={e => { setPin(e.target.value); setError('') }} />
        </Field>
      </form>
    </Modal>
  )
}
