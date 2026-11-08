'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import BottomSheet from '@/components/ui/BottomSheet'
import EmptyState from '@/components/ui/EmptyState'
import ListRow from '@/components/ui/ListRow'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Icons } from '@/components/ui/icons'
import { displayName, formatDate, formatNaira } from '@/lib/format'

type Member = { id: string; slot: number | null; customerDbId: string; customerCode: string; name: string; phone: string; type: string }
type Round = { round: number; label: string; dueDay: string; holderId: string | null; paid: { memberId: string; method: string; at: string }[]; payout: { memberId: string; amount: number; at: string } | null }
type Group = {
  id: string; code: string; name: string; cadence: string; size: number; contribution: number; pot: number; startDate: string
  status: string; currentRound: number | null; members: Member[]; rounds: Round[]
}
type Found = { id: string; customerId: string; firstName: string; lastName: string }

const EVERY: Record<string, string> = { daily: 'a day', weekly: 'a week', monthly: 'a month' }
const naira = (n: number) => formatNaira(n, Number.isInteger(n) ? { minor: false } : {})
const dayText = (day: string) => formatDate(new Date(`${day}T12:00:00+01:00`))

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (res.ok) return null
    const d: { error?: string } = await res.json().catch(() => ({}))
    return d.error ?? 'That didn’t go through. Try again.'
  } catch {
    return 'No connection. Check your internet and try again.'
  }
}

export default function AjoGroupPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [group, setGroup] = useState<Group | null>(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sheet, setSheet] = useState<null | 'add' | 'slots' | 'start' | 'cancel'>(null)
  const [cashFor, setCashFor] = useState<Member | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch(`/api/agent/ajo/${id}`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      setGroup(((await res.json()) as { group: Group }).group)
    } catch { setFailed(true) }
  }, [id])
  useEffect(() => { load() }, [load])

  function openSheet(s: typeof sheet) { setError(''); setSheet(s) }
  function closeAll() { if (busy) return; setSheet(null); setCashFor(null); setRemoving(null); setError('') }

  async function act(url: string, method: string, body?: unknown, after?: () => void) {
    setBusy(true); setError('')
    const err = await send(url, method, body)
    setBusy(false)
    if (err) { setError(err); return false }
    setSheet(null); setCashFor(null); setRemoving(null)
    after?.()
    await load()
    return true
  }

  if (failed && !group) {
    return <div className="ag-page"><section className="ui-card"><EmptyState icon="error" tone="danger" title="Couldn’t load this group" text="Check your connection and try again."
      action={<button type="button" className="ui-btn ui-btn--secondary" onClick={load}>Try again</button>} /></section></div>
  }
  if (!group) return <div className="ag-page"><ListSkeleton count={4} /></div>

  const g = group
  const byId = new Map(g.members.map(m => [m.id, m]))
  const forming = g.status === 'Forming'
  const full = g.members.length === g.size
  const slotted = full && g.members.every(m => m.slot !== null)
  const current = g.currentRound ? g.rounds[g.currentRound - 1] : null
  const paidIds = new Set(current?.paid.map(p => p.memberId) ?? [])
  const shareText = `Join our Ajo group "${g.name}" on Vochus Easy Save. Open the app, tap Group Ajo and enter this code: ${g.code}`

  async function copyCode() {
    try { await navigator.clipboard.writeText(g.code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* no clipboard: the code is on screen */ }
  }
  async function shareCode() {
    if (navigator.share) { try { await navigator.share({ text: shareText }) } catch { /* they closed it */ } return }
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener')
  }

  return (
    <div className="ag-page">
      <section className="ui-card">
        <p className="ui-row-title">{g.name}</p>
        <p className="ui-row-sub">{naira(g.contribution)} {EVERY[g.cadence]} · {g.size} members</p>
        <p className="ag-ajo-pot">{naira(g.pot)}</p>
        <p className="ui-row-sub">Each turn’s pot</p>
      </section>

      {forming && (
        <>
          <section className="ui-card ui-gap-top">
            <p className="ui-label">Join code</p>
            <p className="ag-ajo-code" aria-label={`Join code ${g.code.split('').join(' ')}`}>{g.code}</p>
            <div className="ag-ajo-actions">
              <button type="button" className="ui-btn ui-btn--secondary" onClick={copyCode}>{copied ? 'Copied' : 'Copy code'}</button>
              <button type="button" className="ui-btn ui-btn--primary" onClick={shareCode}><Icons.share size={18} aria-hidden="true" /> Share</button>
            </div>
            <p className="ui-note">Online customers enter this under Group Ajo in their app.</p>
          </section>

          <div className="ui-section-head ui-gap-top"><h2>Members ({g.members.length} of {g.size})</h2></div>
          <div className="ui-card ui-card--list">
            {g.members.length === 0 && <p className="ui-note ui-note--center">No one has joined yet.</p>}
            {g.members.map(m => (
              <ListRow key={m.id} icon="customers" title={m.name}
                sub={m.slot ? g.rounds[m.slot - 1].label : m.type === 'online' ? 'Online' : 'Cash'}
                value={<button type="button" className="ui-link" onClick={() => { setError(''); setRemoving(m) }} aria-label={`Remove ${m.name}`}>Remove</button>} />
            ))}
          </div>
          <div className="ui-stack ui-gap-top">
            {!full && <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => openSheet('add')}><Icons.add size={18} aria-hidden="true" /> Add a cash customer</button>}
            {full && <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => openSheet('slots')}>{slotted ? 'Change who collects when' : 'Choose who collects when'}</button>}
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={!slotted} onClick={() => openSheet('start')}>Start the group</button>
            {!slotted && <p className="ui-note ui-note--center">{full ? 'Give every member a turn to start the group.' : `You need ${g.size - g.members.length} more member${g.size - g.members.length === 1 ? '' : 's'} to start.`}</p>}
            <button type="button" className="ui-btn ui-btn--plain ui-btn--block" onClick={() => openSheet('cancel')}>Cancel this group</button>
          </div>
        </>
      )}

      {g.status === 'Cancelled' && <section className="ui-card ui-gap-top"><EmptyState icon="error" title="This group was cancelled" text="It never started, so no money moved." /></section>}

      {!forming && g.status !== 'Cancelled' && (
        <>
          {current && (
            <>
              <div className="ui-section-head ui-gap-top"><h2>{current.label}</h2></div>
              <section className="ui-card">
                <p className="ui-row-title">{current.paid.length} of {g.size} have paid</p>
                <p className="ui-row-sub">Due {dayText(current.dueDay)}{current.holderId ? ` · ${byId.get(current.holderId)?.name} collects ${naira(g.pot)}` : ''}</p>
                <div className="ui-progress ag-plan-bar" role="progressbar" aria-valuemin={0} aria-valuemax={g.size} aria-valuenow={current.paid.length} aria-label={`${current.paid.length} of ${g.size} paid`}>
                  <span style={{ width: `${(current.paid.length / g.size) * 100}%` }} />
                </div>
              </section>
              <div className="ui-card ui-card--list ui-gap-top">
                {g.members.map(m => {
                  const p = paidIds.has(m.id)
                  return (
                    <ListRow key={m.id} icon="customers" title={m.name} sub={m.type === 'online' ? 'Online' : 'Cash'}
                      value={p
                        ? <span className="ui-status ui-status--sm ui-status--success">Paid</span>
                        : <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => { setError(''); setCashFor(m) }}>Record cash</button>} />
                  )
                })}
              </div>
            </>
          )}

          <div className="ui-section-head ui-gap-top"><h2>All turns</h2></div>
          <div className="ui-card ui-card--list">
            {g.rounds.map(r => {
              const holder = r.holderId ? byId.get(r.holderId)?.name : null
              const state = r.payout ? ['Paid out', 'ui-status--success'] : r.round === g.currentRound ? ['Open', 'ui-status--warn'] : ['Waiting', 'ui-status--neutral']
              return <ListRow key={r.round} icon="calendar" title={r.label} sub={holder ? `${holder} collects` : undefined} value={<span className={`ui-status ui-status--sm ${state[1]}`}>{state[0]}</span>} />
            })}
          </div>
          <p className="ui-note ui-note--center">When a turn is paid out, its member collects from Collections like any finished plan.</p>
        </>
      )}

      <BottomSheet open={sheet === 'add'} onClose={closeAll} title="Add a cash customer">
        {sheet === 'add' && <AddCustomer memberCustomerIds={g.members.map(m => m.customerDbId)} busy={busy} error={error}
          onPick={c => act(`/api/agent/ajo/${g.id}/members`, 'POST', { customerId: c.id })} />}
      </BottomSheet>

      <BottomSheet open={sheet === 'slots'} onClose={closeAll} title="Who collects when">
        {sheet === 'slots' && <SlotsForm group={g} busy={busy} error={error} onSave={slots => act(`/api/agent/ajo/${g.id}/slots`, 'POST', { slots })} />}
      </BottomSheet>

      <BottomSheet open={sheet === 'start'} onClose={closeAll} title="Start this group?">
        <p className="ui-note">Once it starts, members and turns can’t change. Everyone is told when they collect, and the first payment is due {dayText(g.rounds[0].dueDay)}.</p>
        {error && <p className="ui-field-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}
        <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={busy} aria-busy={busy} onClick={() => act(`/api/agent/ajo/${g.id}/lock`, 'POST')}>{busy ? 'Starting…' : 'Start the group'}</button>
      </BottomSheet>

      <BottomSheet open={sheet === 'cancel'} onClose={closeAll} title="Cancel this group?">
        <p className="ui-note">Members will no longer see it. This can’t be undone.</p>
        {error && <p className="ui-field-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}
        <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={busy} aria-busy={busy} onClick={() => act(`/api/agent/ajo/${g.id}`, 'DELETE', undefined, () => router.replace('/dashboard/ajo'))}>{busy ? 'Cancelling…' : 'Cancel the group'}</button>
      </BottomSheet>

      <BottomSheet open={!!removing} onClose={closeAll} title={`Remove ${removing?.name ?? ''}?`}>
        <p className="ui-note">They can join again with the code while the group hasn’t started.</p>
        {error && <p className="ui-field-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}
        <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={busy} aria-busy={busy} onClick={() => removing && act(`/api/agent/ajo/${g.id}/members?memberId=${encodeURIComponent(removing.id)}`, 'DELETE')}>{busy ? 'Removing…' : 'Remove'}</button>
      </BottomSheet>

      <BottomSheet open={!!cashFor} onClose={closeAll} title="Record cash">
        {cashFor && current && (
          <>
            <p className="ui-note">Take {naira(g.contribution)} cash from {cashFor.name} for {current.label}. It comes out of your wallet, the same as Record saving, and you keep the cash.</p>
            {error && <p className="ui-field-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={busy} aria-busy={busy} onClick={() => act(`/api/agent/ajo/${g.id}/contribution`, 'POST', { memberId: cashFor.id })}>{busy ? 'Saving…' : `I’ve taken ${naira(g.contribution)}`}</button>
          </>
        )}
      </BottomSheet>
    </div>
  )
}

function AddCustomer({ memberCustomerIds, busy, error, onPick }: { memberCustomerIds: string[]; busy: boolean; error: string; onPick: (c: Found) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Found[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults(null); return }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        setFailed(false)
        const res = await fetch(`/api/customers?search=${encodeURIComponent(term)}&limit=8`, { signal: ctrl.signal })
        if (!res.ok) throw new Error()
        setResults(((await res.json()) as { customers: Found[] }).customers)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setFailed(true)
      }
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [q])

  const list = results?.filter(c => !memberCustomerIds.includes(c.id)) ?? null
  return (
    <>
      <div className="ui-field">
        <label className="ui-label" htmlFor="ajo-find">Name, phone or customer ID</label>
        <input id="ajo-find" className="ui-input" value={q} autoComplete="off" onChange={e => setQ(e.target.value)} />
      </div>
      {failed && <p className="ui-field-error" role="alert"><Icons.error size={16} aria-hidden="true" /> Couldn’t search. Check your connection.</p>}
      {error && <p className="ui-field-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}
      {list && list.length === 0 && <p className="ui-note ui-note--center">No customer found.</p>}
      {list && list.length > 0 && (
        <div className="ui-card--list">
          {list.map(c => <ListRow key={c.id} icon="customers" title={displayName(`${c.firstName} ${c.lastName}`)} sub={c.customerId} onClick={busy ? undefined : () => onPick(c)} />)}
        </div>
      )}
    </>
  )
}

function SlotsForm({ group, busy, error, onSave }: { group: Group; busy: boolean; error: string; onSave: (slots: Record<string, number>) => void }) {
  const [slots, setSlots] = useState<Record<string, string>>(() => Object.fromEntries(group.members.map(m => [m.id, m.slot ? String(m.slot) : ''])))
  const used = new Set(Object.values(slots).filter(Boolean))
  const complete = group.members.every(m => slots[m.id]) && used.size === group.size

  return (
    <>
      {group.members.map(m => (
        <div className="ui-field" key={m.id}>
          <label className="ui-label" htmlFor={`slot-${m.id}`}>{m.name}</label>
          <select id={`slot-${m.id}`} className="ui-input" value={slots[m.id]} onChange={e => setSlots(s => ({ ...s, [m.id]: e.target.value }))}>
            <option value="">Choose a turn</option>
            {group.rounds.map(r => {
              const takenByOther = used.has(String(r.round)) && slots[m.id] !== String(r.round)
              return <option key={r.round} value={r.round} disabled={takenByOther}>{r.label}{takenByOther ? ' (taken)' : ''}</option>
            })}
          </select>
        </div>
      ))}
      {error && <p className="ui-field-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}
      <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={busy || !complete} aria-busy={busy}
        onClick={() => onSave(Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, Number(v)])))}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </>
  )
}
