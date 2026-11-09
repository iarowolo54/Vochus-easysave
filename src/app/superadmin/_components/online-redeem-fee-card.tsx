'use client'

// Super admin: the Platform Fee online savers pay when they redeem. Loads and saves on its own; a save needs the approver's PIN.
import { useCallback, useEffect, useState } from 'react'
import { onlineFeeOn, type OnlineRedeemFee } from '@/lib/online-redeem-fee'
import { Field, LoadError, TableSkeleton, nairaKobo, useToast } from './admin-ui'

const SAMPLE = 100000
type Drafts = Record<keyof OnlineRedeemFee, string>
const toDrafts = (f: OnlineRedeemFee): Drafts => ({ maturedPct: String(f.maturedPct), earlyPct: String(f.earlyPct), agentSharePct: String(f.agentSharePct) })

export function OnlineRedeemFeeCard() {
  const [saved, setSaved] = useState<OnlineRedeemFee | null>(null)
  const [drafts, setDrafts] = useState<Drafts>({ maturedPct: '', earlyPct: '', agentSharePct: '' })
  const [failed, setFailed] = useState(false)
  const [pin, setPin] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [toastNode, toast] = useToast()

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch('/api/admin/online-redeem-fee', { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const { fee } = await res.json() as { fee: OnlineRedeemFee }
      setSaved(fee); setDrafts(toDrafts(fee))
    } catch { setFailed(true) }
  }, [])
  useEffect(() => { load() }, [load])

  const set = (k: keyof OnlineRedeemFee, v: string) => { setDrafts(d => ({ ...d, [k]: v })); setErrors(e => ({ ...e, [k]: '' })) }
  const preview: OnlineRedeemFee = { maturedPct: Number(drafts.maturedPct) || 0, earlyPct: Number(drafts.earlyPct) || 0, agentSharePct: Number(drafts.agentSharePct) || 0 }
  const end = onlineFeeOn(SAMPLE, preview, false), early = onlineFeeOn(SAMPLE, preview, true)
  const changed = !!saved && (Number(drafts.maturedPct) !== saved.maturedPct || Number(drafts.earlyPct) !== saved.earlyPct || Number(drafts.agentSharePct) !== saved.agentSharePct)

  async function save() {
    setBusy(true); setError(''); setErrors({})
    try {
      const res = await fetch('/api/admin/online-redeem-fee', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...drafts, pin }) })
      const d = await res.json().catch(() => ({})) as { fee?: OnlineRedeemFee; error?: string; errors?: Record<string, string> }
      if (res.ok && d.fee) { setSaved(d.fee); setDrafts(toDrafts(d.fee)); setPin(''); toast('Online Platform Fee saved', 'success'); return }
      setErrors(d.errors ?? {}); setError(d.error ?? 'That didn’t save. Try again.')
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card am-section" aria-labelledby="orf-h">
      <div className="card-hd">
        <div>
          <h3 id="orf-h">Online savers’ Platform Fee</h3>
          <p className="am-card-sub">Taken from the amount saved when an online customer redeems. Nothing is charged on deposits or on interest. Changes apply to every online redemption from then on.</p>
        </div>
      </div>
      {failed && !saved ? <LoadError what="the fee" onRetry={load} /> : !saved ? <TableSkeleton rows={2} cols={2} /> : (
        <form onSubmit={e => { e.preventDefault(); if (changed && pin) save() }} noValidate>
          <div className="am-2col">
            <Field id="orf-end" label="Redeeming at the end (%)" error={errors.maturedPct}>
              <input id="orf-end" className="a-input" type="text" inputMode="decimal" autoComplete="off" value={drafts.maturedPct} aria-invalid={!!errors.maturedPct} onChange={e => set('maturedPct', e.target.value)} />
            </Field>
            <Field id="orf-early" label="Redeeming early (%)" error={errors.earlyPct}>
              <input id="orf-early" className="a-input" type="text" inputMode="decimal" autoComplete="off" value={drafts.earlyPct} aria-invalid={!!errors.earlyPct} onChange={e => set('earlyPct', e.target.value)} />
            </Field>
          </div>
          <Field id="orf-agent" label="Agent’s share of the fee (%)" error={errors.agentSharePct} hint="The platform keeps the rest.">
            <input id="orf-agent" className="a-input" type="text" inputMode="decimal" autoComplete="off" value={drafts.agentSharePct} aria-invalid={!!errors.agentSharePct} onChange={e => set('agentSharePct', e.target.value)} />
          </Field>
          <p className="dlg-note">On {nairaKobo(SAMPLE)} saved: {nairaKobo(end.fee)} at the end, {nairaKobo(early.fee)} early. The agent gets {nairaKobo(end.agent)} or {nairaKobo(early.agent)} of that.</p>
          {changed && <Field id="orf-pin" label="Approval PIN"><input id="orf-pin" className="a-input am-pin" type="password" inputMode="numeric" maxLength={6} autoComplete="off" placeholder="••••" value={pin} onChange={e => setPin(e.target.value)} /></Field>}
          {error && <p className="a-alert a-alert-a" role="alert">{error}</p>}
          <button type="submit" className="btn btn-green" disabled={busy || !changed || !pin}>{busy ? 'Saving…' : 'Save'}</button>
        </form>
      )}
      {toastNode}
    </section>
  )
}
