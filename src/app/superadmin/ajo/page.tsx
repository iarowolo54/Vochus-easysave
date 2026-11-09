'use client'

import { useCallback, useEffect, useState } from 'react'
import { ajoFeeOn } from '@/lib/ajo'
import { Empty, Field, LoadError, Modal, PageHeader, TableSkeleton, naira, useToast } from '../_components/admin-ui'

type Fee = { feePct: number; agentSharePct: number }
type Group = {
  id: string; name: string; status: string; cadence: string; size: number; contribution: number; pot: number
  agentName: string; agentCode: string; memberCount: number; round: number | null; roundLabel: string | null
  paidThisRound: number; dueDay: string | null; overdue: boolean; inPool: number; paidOutRounds: number
}

const STATUS: Record<string, [string, string]> = {
  Forming: ['Getting members', 'bdg-b'], Running: ['Running', 'bdg-g'], Completed: ['Finished', 'bdg-grey'], Cancelled: ['Cancelled', 'bdg-grey'],
}

export default function AjoGroupsAdminPage() {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [manage, setManage] = useState<Group | null>(null)
  const [fee, setFee] = useState<Fee | null>(null)
  const [editFee, setEditFee] = useState(false)
  const [toastNode, toast] = useToast()

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch('/api/admin/ajo', { cache: 'no-store' })
      if (!res.ok) throw new Error()
      setGroups(((await res.json()) as { groups: Group[] }).groups)
    } catch { setFailed(true) }
  }, [])
  const loadFee = useCallback(() => {
    fetch('/api/admin/ajo/fee', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then((d: { fee?: Fee } | null) => { if (d?.fee) setFee(d.fee) }).catch(() => {})
  }, [])
  useEffect(() => { load(); loadFee() }, [load, loadFee])

  const overdue = groups?.filter(g => g.overdue).length ?? 0
  const held = groups?.reduce((s, g) => s + g.inPool, 0) ?? 0

  return (
    <>
      <PageHeader title="Ajo groups" sub="Groups agents run, the money waiting in each, and turns that are overdue. Payouts appear under Redemptions." />
      {failed && !groups ? <section className="card"><LoadError what="Ajo groups" onRetry={load} /></section> : (
        <>
          <div className="stats-grid am-stats-3">
            <div className="stat"><div className="stat-lbl">Groups running</div><div className="stat-val">{groups ? groups.filter(g => g.status === 'Running').length : '—'}</div></div>
            <div className="stat"><div className="stat-lbl">Paid in, not yet paid out</div><div className="stat-val">{groups ? naira(held) : '—'}</div></div>
            <div className="stat"><div className="stat-lbl">Overdue turns</div><div className="stat-val">{groups ? overdue : '—'}</div></div>
          </div>
          <section className="card am-section" aria-labelledby="ajo-fee-h">
            <div className="card-hd">
              <div>
                <h3 id="ajo-fee-h">Platform Fee</h3>
                <p className="am-card-sub">Taken from each pot when its member redeems. Refunds aren’t charged. A group keeps the rate it started with.</p>
              </div>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setEditFee(true)} disabled={!fee}>Edit</button>
            </div>
            <dl className="dlg-ledger am-ajo-fee">
              <div><dt>Fee on each pot</dt><dd className="dlg-strong">{fee ? `${fee.feePct}%` : '—'}</dd></div>
              <div><dt>Agent’s share of the fee</dt><dd>{fee ? `${fee.agentSharePct}%` : '—'}</dd></div>
              <div><dt>Platform’s share of the fee</dt><dd>{fee ? `${Math.round((100 - fee.agentSharePct) * 100) / 100}%` : '—'}</dd></div>
            </dl>
          </section>
          <section className="card" aria-labelledby="ajo-h">
            <div className="card-hd"><h3 id="ajo-h">Groups</h3></div>
            {!groups ? <TableSkeleton rows={4} cols={6} />
              : groups.length === 0 ? <Empty icon="staff" title="No Ajo groups yet" text="Groups show here when agents create them." />
              : (
                <div className="tbl-wrap tbl-stack">
                  <table>
                    <thead><tr><th>Group</th><th>Agent</th><th className="num">Each pays</th><th>This turn</th><th className="num">In the pool</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {groups.map(g => {
                        const [label, cls] = STATUS[g.status] ?? [g.status, 'bdg-grey']
                        return (
                          <tr key={g.id}>
                            <td className="td-name">{g.name}<div className="am-muted">{g.memberCount} of {g.size} members · {g.cadence}</div></td>
                            <td data-label="Agent">{g.agentName}<div className="am-muted">{g.agentCode}</div></td>
                            <td className="num" data-label="Each pays">{naira(g.contribution)}</td>
                            <td data-label="This turn">{g.roundLabel ? <>{g.roundLabel}<div className="am-muted">{g.paidThisRound} of {g.size} paid</div></> : <span className="am-muted">None</span>}</td>
                            <td className="num am-strong" data-label="In the pool">{naira(g.inPool)}</td>
                            <td data-label="Status"><span className={`bdg ${g.overdue ? 'bdg-a' : cls}`}>{g.overdue ? 'Overdue' : label}</span></td>
                            <td>{g.status === 'Running' && <button type="button" className="btn btn-sm btn-outline" onClick={() => setManage(g)} aria-label={`Manage ${g.name}`}>Manage</button>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </section>
        </>
      )}
      {editFee && fee && <EditFee fee={fee} onClose={() => setEditFee(false)} onDone={f => { setFee(f); setEditFee(false); toast('Platform Fee saved', 'success') }} />}
      {manage && <ManageGroup group={manage} onClose={() => setManage(null)} onDone={msg => { setManage(null); toast(msg, 'success'); void load() }} />}
      {toastNode}
    </>
  )
}

const EXAMPLE_POT = 30000

function EditFee({ fee, onClose, onDone }: { fee: Fee; onClose: () => void; onDone: (f: Fee) => void }) {
  const [feePct, setFeePct] = useState(String(fee.feePct))
  const [agentSharePct, setAgentSharePct] = useState(String(fee.agentSharePct))
  const [pin, setPin] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const example = ajoFeeOn(EXAMPLE_POT, { feePct: Number(feePct) || 0, agentSharePct: Number(agentSharePct) || 0 })

  async function save() {
    setBusy(true); setError(''); setErrors({})
    try {
      const res = await fetch('/api/admin/ajo/fee', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feePct, agentSharePct, pin }) })
      const d = await res.json().catch(() => ({})) as { fee?: Fee; error?: string; errors?: Record<string, string> }
      if (res.ok && d.fee) { onDone(d.fee); return }
      setErrors(d.errors ?? {}); setError(d.error ?? 'That didn’t save. Try again.')
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal icon="commission" title="Platform Fee" sub="Applies to groups that start from now on. Groups already running keep their rate." onClose={onClose} busy={busy} error={error || undefined}
      footer={<>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-green" onClick={save} disabled={busy || !pin}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <form onSubmit={e => { e.preventDefault(); if (pin) save() }} noValidate>
        <div className="am-2col">
          <Field id="af-fee" label="Fee on each pot (%)" error={errors.feePct}>
            <input id="af-fee" className="a-input" type="text" inputMode="decimal" autoComplete="off" value={feePct} aria-invalid={!!errors.feePct} onChange={e => setFeePct(e.target.value)} />
          </Field>
          <Field id="af-agent" label="Agent’s share of it (%)" error={errors.agentSharePct}>
            <input id="af-agent" className="a-input" type="text" inputMode="decimal" autoComplete="off" value={agentSharePct} aria-invalid={!!errors.agentSharePct} onChange={e => setAgentSharePct(e.target.value)} />
          </Field>
        </div>
        <p className="dlg-note">On a {naira(EXAMPLE_POT)} pot: {naira(example.fee)} fee, {naira(example.agent)} to the agent and {naira(example.platform)} to the platform.</p>
        <Field id="af-pin" label="Approval PIN"><input id="af-pin" className="a-input am-pin" type="password" inputMode="numeric" maxLength={6} autoComplete="off" placeholder="••••" value={pin} onChange={e => setPin(e.target.value)} /></Field>
      </form>
    </Modal>
  )
}

type Detail = { members: { id: string; slot: number | null; name: string; customerCode: string }[]; rounds: { round: number; label: string; paid: { memberId: string }[]; payout: { memberId: string } | null }[]; currentRound: number | null }

/** Staff action for a stuck group: put someone in a member's place. */
function ManageGroup({ group, onClose, onDone }: { group: Group; onClose: () => void; onDone: (msg: string) => void }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [mode, setMode] = useState<{ memberId: string; name: string } | null>(null)
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/admin/ajo/${group.id}`, { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: { group: Detail }) => setDetail(d.group))
      .catch(() => setError('Couldn’t load this group. Close this and try again.'))
  }, [group.id])

  function choose(m: typeof mode) { setMode(m); setCode(''); setNote(''); setPin(''); setError('') }

  async function submit() {
    if (!mode) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/admin/ajo/${group.id}/replace`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim(), pin, memberId: mode.memberId, customerCode: code.trim() }),
      })
      if (res.ok) { onDone('Member replaced'); return }
      const d = await res.json().catch(() => ({})) as { error?: string }
      setError(d.error ?? 'That didn’t go through. Try again.')
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setBusy(false)
    }
  }

  const open = detail?.currentRound ? detail.rounds[detail.currentRound - 1] : null
  const ready = note.trim().length >= 3 && pin.length > 0 && code.trim().length > 0
  return (
    <Modal icon="staff" size="lg" title={mode ? `Replace ${mode.name}` : group.name}
      sub={mode ? 'The new customer takes over this turn and pays every turn from now on. What this member already paid comes out of that turn’s pot and goes back to them.' : undefined}
      onClose={onClose} busy={busy} error={error || undefined}
      footer={mode ? <>
        <button type="button" className="btn btn-outline" onClick={() => choose(null)} disabled={busy}>Back</button>
        <button type="button" className="btn btn-green" onClick={submit} disabled={busy || !ready}>{busy ? 'Saving…' : 'Replace member'}</button>
      </> : <>
        <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
      </>}>
      {!detail && !error && <TableSkeleton rows={3} cols={3} />}
      {detail && !mode && (
        <div className="tbl-wrap tbl-stack">
          <table>
            <thead><tr><th>Turn</th><th>Member</th><th>{open ? open.label : 'This turn'}</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {[...detail.members].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)).map(m => {
                const collected = detail.rounds.some(r => r.payout?.memberId === m.id)
                const paid = !!open?.paid.some(p => p.memberId === m.id)
                return (
                  <tr key={m.id}>
                    <td className="am-nowrap" data-label="Turn">{m.slot ? detail.rounds[m.slot - 1].label : ''}</td>
                    <td className="td-name">{m.name}<div className="am-muted">{m.customerCode}</div></td>
                    <td data-label="This turn"><span className={`bdg ${paid ? 'bdg-g' : 'bdg-a'}`}>{paid ? 'Paid' : 'Not paid'}</span></td>
                    <td>{collected ? <span className="am-muted">Redeemed</span> : <button type="button" className="btn btn-sm btn-outline" onClick={() => choose({ memberId: m.id, name: m.name })}>Replace</button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {mode && (
        <form onSubmit={e => { e.preventDefault(); if (ready) submit() }} noValidate>
          <Field id="aj-code" label="New customer’s ID" hint="They must belong to this group’s agent.">
            <input id="aj-code" className="a-input" value={code} autoComplete="off" placeholder="CST-00123" onChange={e => setCode(e.target.value)} />
          </Field>
          <Field id="aj-note" label="Why"><input id="aj-note" className="a-input" value={note} maxLength={300} autoComplete="off" onChange={e => setNote(e.target.value)} /></Field>
          <Field id="aj-pin" label="Approval PIN"><input id="aj-pin" className="a-input am-pin" type="password" inputMode="numeric" maxLength={6} autoComplete="off" placeholder="••••" value={pin} onChange={e => setPin(e.target.value)} /></Field>
        </form>
      )}
    </Modal>
  )
}
