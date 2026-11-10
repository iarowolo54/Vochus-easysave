'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import {
  AmountHero, Empty, Field, Ledger, LedgerRow, LoadError, Modal, PageHeader, Pager, SearchField, Segmented, TableSkeleton,
  dateTime, nairaKobo, useDebounced, useToast,
} from '../_components/admin-ui'
import NoAccess from '../_components/NoAccess'
import DayChoice from './DayChoice'

type Status = 'paid' | 'waiting' | 'not-paid' | 'cancelled' | 'needs-review' | 'by-hand'
type Filter = 'all' | Status
type Who = { type: 'customer' | 'agent'; name: string; code: string }

interface Row {
  kind: 'request' | 'alert'
  id: string
  ref: string
  at: string
  who: Who | null
  plan: string | null
  amount: number
  status: Status
  statusLabel: string
  summary: string
  actionable: boolean
  startedAt: string | null
  expiresAt: string | null
  creditedAt: string | null
  by: string | null
  doneAt: string | null
  note: string | null
  bank: { sender: string; narration: string; txnId: string; bankTime: string; seenAt: string } | null
  possible: { who: Who | null; plan: string | null; amount: number; startedAt: string; state: string; leftOutKobo: boolean }[]
  possibleMore: number
  lookalike: boolean
  leftOutKobo: boolean
}
interface Page {
  rows: Row[]
  total: number
  page: number
  pageSize: number
  counts: Record<Filter, number> & { leftOutKobo: number }
  truncated: boolean
  canManage: boolean
}
interface Person { id: string; code: string; name: string; plans: { id: string; goal: string; balance: number }[] }

const BADGE: Record<Status, string> = {
  paid: 'bdg-g', waiting: 'bdg-b', 'not-paid': 'bdg-grey', cancelled: 'bdg-grey', 'needs-review': 'bdg-a', 'by-hand': 'bdg-p',
}
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs-review', label: 'Needs review' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'not-paid', label: 'Not paid' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'paid', label: 'Paid' },
  { value: 'by-hand', label: 'Credited by hand' },
]

type Dialog =
  | { type: 'detail'; row: Row }
  | { type: 'request'; row: Row }
  | { type: 'alert'; row: Row }
  | { type: 'dismiss'; row: Row }

/** Long text that must wrap, not run past the edge or get cut off. */
const wrap = { whiteSpace: 'normal', overflowWrap: 'anywhere', textAlign: 'right' } as const
const wrapLeft = { whiteSpace: 'normal', overflowWrap: 'anywhere' } as const

const whoLabel = (w: Who | null) => (w ? `${w.name} · ${w.code} (${w.type === 'agent' ? 'agent' : 'customer'})` : 'Not known yet')

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
      <PageHeader title="Bank transfers" sub="Money that customers and agents send to the Moniepoint account. Select a row to see everything about it, and credit a payment by hand if it didn’t arrive on its own." />

      {counts && counts['needs-review'] > 0 && (
        <div className="a-alert a-alert-a" role="status">
          {counts['needs-review']} payment{counts['needs-review'] === 1 ? ' needs' : 's need'} a look. The money reached the bank but couldn’t be credited on its own.
        </div>
      )}

      {counts && counts.leftOutKobo > 0 && (
        <div className="a-alert a-alert-a" role="status">
          {counts.leftOutKobo} {counts.leftOutKobo === 1 ? 'person says' : 'people say'} they sent money without the extra kobo. Look for it under “Needs review”, then credit it to them by hand.
        </div>
      )}

      <div className="toolbar bt-toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Name, ID, plan, sender or amount" label="Search bank transfers" />
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
                    <tr><th>When</th><th>Who</th><th className="num">Amount</th><th>Status and next step</th></tr>
                  </thead>
                  <tbody>
                    {data.rows.map(r => (
                      <tr key={`${r.kind}-${r.id}`} className="bt-row" onClick={() => setDialog({ type: 'detail', row: r })}>
                        <td data-label="When" className="cm-nowrap cm-sub2">
                          <button type="button" className="cm-cell-btn" aria-label={`See details of the ${nairaKobo(r.amount)} transfer`}
                            onClick={e => { e.stopPropagation(); setDialog({ type: 'detail', row: r }) }}>
                            {dateTime(r.at)}
                          </button>
                        </td>
                        <td data-label="Who">
                          {r.who ? (<>
                            <div className="td-name">{r.who.name}</div>
                            <div className="td-sub">{r.who.type === 'agent' ? 'Agent' : 'Customer'} · {r.who.code}</div>
                            <div className="td-sub">{r.who.type === 'agent' ? 'Wallet top-up' : r.plan ?? 'Savings'}</div>
                          </>)
                            : <><span className="cm-muted">{r.kind === 'alert' ? 'Not assigned yet' : '—'}</span>{r.bank?.sender && <div className="td-sub bt-note">Sent by {r.bank.sender}</div>}</>}
                        </td>
                        <td data-label="Amount" className="num cm-strong">{nairaKobo(r.amount)}</td>
                        <td data-label="Status">
                          <span className={`bdg ${BADGE[r.status]}`}>{r.statusLabel}</span>
                          <div className="td-sub bt-note">{r.summary}</div>
                          <div className="bt-actions" onClick={e => e.stopPropagation()}>
                            {data.canManage && r.actionable && (r.kind === 'request'
                              ? <button type="button" className="btn btn-outline btn-sm" onClick={() => setDialog({ type: 'request', row: r })}>Credit this payment</button>
                              : <>
                                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setDialog({ type: 'alert', row: r })}>Credit to someone</button>
                                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setDialog({ type: 'dismiss', row: r })}>Dismiss</button>
                                </>)}
                            <button type="button" className="ui-link" onClick={() => setDialog({ type: 'detail', row: r })}>View details</button>
                          </div>
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

      {dialog?.type === 'detail' && (
        <DetailDialog row={dialog.row} canManage={!!data?.canManage} onClose={() => setDialog(null)}
          onAction={type => setDialog({ type, row: dialog.row })} />
      )}
      {dialog && dialog.type !== 'detail' && (
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="cm-sec">
      <h3 className="cm-sec-title">{title}</h3>
      {children}
    </div>
  )
}

/** Everything the system knows about one transfer, in plain words, with the actions it allows. */
function DetailDialog({ row, canManage, onClose, onAction }: {
  row: Row; canManage: boolean; onClose: () => void; onAction: (type: 'request' | 'alert' | 'dismiss') => void
}) {
  const r = row
  const explain: Record<Status, string> = {
    paid: 'The bank’s credit alert arrived with exactly this amount and it was credited automatically.',
    waiting: 'The person was shown this account and exact amount. We are waiting for the bank’s alert. Do not credit it until you have seen the money in the Moniepoint account.',
    'not-paid': 'The 30 minutes ran out and no alert for this exact amount arrived. If the person says they paid, check the Moniepoint account before crediting.',
    cancelled: 'The person cancelled this request on their phone before paying. Nothing is owed. If they say they paid anyway, look for the money in the Moniepoint account; if it arrived it will show here as money received with no matching request.',
    'needs-review': 'Money reached the bank account, but it matched no open request, so nothing was credited. Find out who it belongs to, then credit it to them or dismiss it.',
    'by-hand': 'Staff credited this by hand.',
  }
  const unmatched = r.kind === 'alert' && r.status === 'needs-review'

  return (
    <Modal title="Transfer details" size="lg" icon="deposit" onClose={onClose}
      sub={<span className={`bdg ${BADGE[r.status]}`}>{r.statusLabel}</span>}
      footer={<>
        <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
        {canManage && r.actionable && (r.kind === 'request'
          ? <button type="button" className="btn btn-green" onClick={() => onAction('request')}>Credit this payment by hand</button>
          : <>
              <button type="button" className="btn btn-outline" onClick={() => onAction('dismiss')}>Dismiss: not a deposit</button>
              <button type="button" className="btn btn-green" onClick={() => onAction('alert')}>Credit to a customer or agent</button>
            </>)}
      </>}>
      <AmountHero label={r.kind === 'alert' ? 'Amount that arrived' : 'Amount to send'} amount={nairaKobo(r.amount)} />
      <p style={wrapLeft}>{explain[r.status]}</p>

      {unmatched && (
        <p className="a-hint" style={wrapLeft}>
          Why it wasn’t matched: no open request had exactly {nairaKobo(r.amount)}. Usually the sender left out the extra kobo and sent a rounded figure instead of the exact amount shown, paid after the 30 minutes, or this isn’t a customer or agent payment.
        </p>
      )}
      {r.leftOutKobo && (
        <div className="a-alert a-alert-a" role="status">The person told us on their screen that they sent this without the extra kobo. Their money should be in “Needs review” as a payment that matched nothing. Check the Moniepoint account, then credit it to them by hand.</div>
      )}
      {r.lookalike && (
        <div className="a-alert a-alert-a" role="status">This is within ₦1 of a payment staff credited by hand around the same time. It may be the same money, so check before crediting it again.</div>
      )}

      <Section title="Who">
        <Ledger>
          <LedgerRow label={r.kind === 'alert' && !r.who ? 'Assigned to' : 'Person'}><span style={wrap}>{whoLabel(r.who)}</span></LedgerRow>
          <LedgerRow label="For"><span style={wrap}>{r.who?.type === 'agent' ? 'Agent wallet top-up' : r.plan ? `Savings plan: ${r.plan}` : r.kind === 'alert' ? 'Not assigned yet' : 'Savings'}</span></LedgerRow>
        </Ledger>
      </Section>

      {r.bank && (
        <Section title="What the bank told us">
          <Ledger>
            <LedgerRow label="Sent by"><span style={wrap}>{r.bank.sender || 'Not shown'}</span></LedgerRow>
            <LedgerRow label="Bank narration"><span style={wrap}>{r.bank.narration || 'Not shown'}</span></LedgerRow>
            <LedgerRow label="Bank transaction ID"><span className="cm-ref" style={wrap}>{r.bank.txnId}</span></LedgerRow>
            <LedgerRow label="Money arrived"><span style={wrap}>{dateTime(r.bank.bankTime)}</span></LedgerRow>
            <LedgerRow label="We saw the alert"><span style={wrap}>{dateTime(r.bank.seenAt)}</span></LedgerRow>
          </Ledger>
        </Section>
      )}

      {r.kind === 'request' && (
        <Section title="The request">
          <Ledger>
            <LedgerRow label="Reference"><span className="cm-ref" style={wrap}>{r.ref}</span></LedgerRow>
            <LedgerRow label="Started"><span style={wrap}>{r.startedAt ? dateTime(r.startedAt) : '—'}</span></LedgerRow>
            <LedgerRow label="Window closes"><span style={wrap}>{r.expiresAt ? dateTime(r.expiresAt) : '—'}</span></LedgerRow>
            <LedgerRow label="Credited"><span style={wrap}>{r.creditedAt ? dateTime(r.creditedAt) : 'Not credited'}</span></LedgerRow>
          </Ledger>
        </Section>
      )}

      {(r.by || r.note) && (
        <Section title="Staff action">
          <Ledger>
            <LedgerRow label="By"><span style={wrap}>{r.by ?? '—'}</span></LedgerRow>
            <LedgerRow label="When"><span style={wrap}>{r.doneAt ? dateTime(r.doneAt) : '—'}</span></LedgerRow>
            <LedgerRow label="Note"><span style={wrap}>{r.note ?? '—'}</span></LedgerRow>
          </Ledger>
        </Section>
      )}

      {unmatched && (
        <Section title="Requests that were started for about this amount">
          {r.possible.length === 0 ? (
            <p className="a-hint">None in the day before this money arrived.</p>
          ) : (
            <Ledger>
              {r.possible.map((p, i) => (
                <LedgerRow key={i} label={p.who ? `${p.who.name} · ${p.who.code}` : 'Unknown'}>
                  <span style={wrap}>{nairaKobo(p.amount)} shown {dateTime(p.startedAt)} · {p.state}{p.plan ? ` · ${p.plan}` : ''}{p.leftOutKobo ? ' · says they left the kobo out' : ''}</span>
                </LedgerRow>
              ))}
            </Ledger>
          )}
          {r.possibleMore > 0 && <p className="a-hint">{r.possibleMore} more {r.possibleMore === 1 ? 'person has' : 'people have'} a request near this amount and {r.possibleMore === 1 ? 'is' : 'are'} not shown.</p>}
          <p className="a-hint">A close amount is not proof. Only credit someone after you have confirmed they are the sender, for example from the sender’s name above or a receipt they show you. The amount credited is the amount that arrived.</p>
        </Section>
      )}
    </Modal>
  )
}

function ActionDialog({ dialog, onClose, onDone }: { dialog: Exclude<Dialog, { type: 'detail' }>; onClose: () => void; onDone: (msg: string) => void }) {
  const { row } = dialog
  const [note, setNote] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // "Credit to someone" only: who gets the money.
  const [kind, setKind] = useState<'customer' | 'agent'>('customer')
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim())
  const [people, setPeople] = useState<Person[]>([])
  const [person, setPerson] = useState<Person | null>(null)
  const [planId, setPlanId] = useState('')
  // Held money that looks like a payment already credited by hand needs a tick to say it was checked.
  const [ack, setAck] = useState(false)
  const needsAck = (dialog.type === 'alert' || dialog.type === 'request') && row.lookalike
  const [days, setDays] = useState<string[]>([])
  useEffect(() => { setDays([]) }, [planId])

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
  const ready = targetOk && note.trim().length >= 3 && pin.length > 0 && (!needsAck || ack)

  async function submit() {
    if (!ready) return
    setBusy(true); setError('')
    const [url, body] =
      dialog.type === 'request' ? ['credit-request', { ref: row.ref }] as const
      : dialog.type === 'dismiss' ? ['dismiss-alert', { alertId: row.id }] as const
      : ['credit-alert', { alertId: row.id, target: kind === 'agent' ? { kind, agentId: person?.id } : { kind, customerId: person?.id, planId, ...(days.length > 0 ? { days } : {}) } }] as const
    try {
      const res = await fetch(`/api/admin/bank-transfers/${url}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, note: note.trim(), pin, ...(needsAck ? { ackLookalike: ack } : {}) }),
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
        sub={row.who ? <>for <strong>{row.who.name}</strong> · {row.who.code}</> : row.bank ? <>sent by <strong>{row.bank.sender || 'an unknown sender'}</strong></> : null} />

      {row.bank && dialog.type !== 'request' && (
        <p className="a-hint" style={{ ...wrapLeft, marginBottom: 14 }}>Bank narration: {row.bank.narration || 'not shown'}</p>
      )}
      {needsAck && (
        <div className="a-alert a-alert-a" role="alert" style={{ marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <p style={wrapLeft}>This is within ₦1 of a payment staff credited by hand around the same time. It may be the same money.</p>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, minHeight: 32 }}>
              <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18, flex: 'none' }} />
              <span style={wrapLeft}>I have checked it is not the same payment.</span>
            </label>
          </div>
        </div>
      )}

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
          {person && kind === 'customer' && planId && <DayChoice planId={planId} amount={row.amount} value={days} onChange={setDays} />}
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
        {/* Enter in a field submits: the Credit button lives in the dialog footer, outside this form. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" disabled={busy || !ready}>Submit</button>
      </form>
    </Modal>
  )
}
