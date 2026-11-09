'use client'

// Super admin: the flexible savings settings (shortest plan, smallest deposit, commission, penalty and the agent's shares).
// Loads and saves on its own; a save needs the approver's PIN, like commission rates.
import { useCallback, useEffect, useState } from 'react'
import { blockMinus, nonNegativeString } from '@/lib/numeric'
import { Icons } from '@/components/ui/icons'
import { DEFAULT_FLEXIBLE_SETTINGS, type FlexibleSettings } from '@/lib/flexible-savings'
import { ConfirmModal, Field, LoadError, TableSkeleton, nairaKobo, useToast } from './admin-ui'

type Key = keyof FlexibleSettings
type Unit = 'months' | 'naira' | 'pct'
const SAMPLE = 100000

const FIELDS: { key: Key; unit: Unit; label: string; max: number; example: (v: number, all: FlexibleSettings) => string }[] = [
  { key: 'minTermMonths', unit: 'months', label: 'Shortest plan, in months', max: 60, example: v => `Customers must pick an end date at least ${v} month${v === 1 ? '' : 's'} after the start.` },
  { key: 'minDeposit', unit: 'naira', label: 'Smallest deposit', max: 1_000_000, example: v => `Any amount from ${nairaKobo(v)} up, any day, as often as they like.` },
  { key: 'cashCommissionPct', unit: 'pct', label: 'Commission when an offline customer redeems', max: 25, example: v => `On ${nairaKobo(SAMPLE)} redeemed the commission is ${nairaKobo(SAMPLE * v / 100)}. Online customers don’t pay it. At most 25%.` },
  { key: 'cashCommissionAgentPct', unit: 'pct', label: 'Agent’s share of the commission', max: 100, example: (v, a) => `Of a ${nairaKobo(SAMPLE * a.cashCommissionPct / 100)} commission the agent gets ${nairaKobo(SAMPLE * a.cashCommissionPct / 100 * v / 100)}.` },
  { key: 'penaltyPct', unit: 'pct', label: 'Penalty for stopping before the end date', max: 25, example: v => `Offline and online. On ${nairaKobo(SAMPLE)} the penalty is ${nairaKobo(SAMPLE * v / 100)}. At most 25%.` },
  { key: 'penaltyAgentPct', unit: 'pct', label: 'Agent’s share of the penalty', max: 100, example: (v, a) => `Of a ${nairaKobo(SAMPLE * a.penaltyPct / 100)} penalty the agent gets ${nairaKobo(SAMPLE * a.penaltyPct / 100 * v / 100)}.` },
]

type Drafts = Record<Key, string>
const toDrafts = (s: FlexibleSettings) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)])) as Drafts
const show = (unit: Unit, v: number) => unit === 'pct' ? `${v}%` : unit === 'naira' ? nairaKobo(v) : `${v} months`

function parse(f: (typeof FIELDS)[number], s: string): number | null {
  if (s.trim() === '') return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0 || n > f.max) return null
  if (f.unit === 'months' && (!Number.isInteger(n) || n < 1)) return null
  return n
}

export function FlexibleSavingsCard() {
  const [saved, setSaved] = useState<FlexibleSettings>(DEFAULT_FLEXIBLE_SETTINGS)
  const [drafts, setDrafts] = useState<Drafts>(toDrafts(DEFAULT_FLEXIBLE_SETTINGS))
  const [state, setState] = useState<'loading' | 'failed' | 'ready'>('loading')
  const [confirm, setConfirm] = useState(false)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lastSaved, setLastSaved] = useState('')
  const [toastNode, toast] = useToast()

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await fetch('/api/admin/flexible-savings', { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const d = await res.json() as { settings: FlexibleSettings }
      setSaved(d.settings); setDrafts(toDrafts(d.settings)); setState('ready')
    } catch {
      setState('failed')
    }
  }, [])
  useEffect(() => { load() }, [load])

  const parsed = Object.fromEntries(FIELDS.map(f => [f.key, parse(f, drafts[f.key])])) as Record<Key, number | null>
  const valid = FIELDS.every(f => parsed[f.key] !== null)
  const changes = FIELDS.filter(f => parsed[f.key] !== saved[f.key])
  const current: FlexibleSettings = { ...saved }
  for (const f of FIELDS) current[f.key] = parsed[f.key] ?? saved[f.key]

  async function save() {
    if (!valid) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/admin/flexible-savings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: current, pin }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string; settings?: FlexibleSettings }
      if (!res.ok || !d.settings) { setError(d.error ?? 'The settings weren’t saved. Nothing changed. Try again.'); return }
      setSaved(d.settings); setDrafts(toDrafts(d.settings))
      setLastSaved(`Saved at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`)
      setConfirm(false); setPin('')
      toast('Flexible savings settings saved', 'success')
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card am-section" aria-labelledby="flex-h">
      {toastNode}
      <div className="card-hd">
        <div>
          <h3 id="flex-h">Flexible savings</h3>
          <p className="am-card-sub">Any amount, any day, until an end date the customer picks. Nothing is taken from deposits; charges come off when they redeem.</p>
        </div>
      </div>
      {state === 'failed' ? <LoadError what="flexible savings settings" onRetry={load} />
        : state === 'loading' ? <TableSkeleton rows={3} cols={3} />
        : (
          <>
            <div className="am-rate-groups">
              <div className="am-rate-group">
                <div className="am-rate-group-hd">
                  <span className="row-ic" aria-hidden="true"><Icons.rate size={18} /></span>
                  <div>
                    <h4>Plan rules</h4>
                    <p>What customers can choose.</p>
                  </div>
                </div>
                {FIELDS.slice(0, 2).map(f => <SettingField key={f.key} f={f} value={drafts[f.key]} invalid={parsed[f.key] === null} hint={f.example(current[f.key], current)} onChange={s => setDrafts(d => ({ ...d, [f.key]: s }))} />)}
              </div>
              <div className="am-rate-group">
                <div className="am-rate-group-hd">
                  <span className="row-ic" aria-hidden="true"><Icons.treasury size={18} /></span>
                  <div>
                    <h4>Charges when they redeem</h4>
                    <p>A percentage of what is in the plan. The platform keeps what the agent doesn’t get.</p>
                  </div>
                </div>
                {FIELDS.slice(2).map(f => <SettingField key={f.key} f={f} value={drafts[f.key]} invalid={parsed[f.key] === null} hint={f.example(current[f.key], current)} onChange={s => setDrafts(d => ({ ...d, [f.key]: s }))} />)}
              </div>
            </div>
            <div className="am-foot">
              <div className="am-foot-info">
                <span>A change applies to redemptions asked for after you save.</span>
                {lastSaved && <span>{lastSaved}</span>}
              </div>
              <div className="am-foot-actions">
                <button type="button" className="btn btn-green" disabled={!valid || changes.length === 0} onClick={() => { setError(''); setConfirm(true) }}>
                  {changes.length === 0 ? 'No changes' : 'Save changes'}
                </button>
              </div>
            </div>
          </>
        )}

      {confirm && (
        <ConfirmModal icon="rate" title="Save flexible savings settings?" confirmLabel="Save settings" busy={busy} error={error}
          body={<>
            These apply to every agent and customer from now. Redemptions already asked for don’t change.
            <ul className="am-diff">
              {changes.map(f => (
                <li key={f.key}><span>{f.label}</span><span className="am-diff-val"><span className="am-diff-old">{show(f.unit, saved[f.key])}</span>{show(f.unit, current[f.key])}</span></li>
              ))}
            </ul>
            <Field id="flex-pin" label="Your approval PIN">
              <input id="flex-pin" className="a-input" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={e => setPin(e.target.value)} />
            </Field>
          </>}
          onConfirm={save}
          onClose={() => { if (!busy) { setConfirm(false); setPin('') } }} />
      )}
    </section>
  )
}

function SettingField({ f, value, invalid, hint, onChange }: { f: (typeof FIELDS)[number]; value: string; invalid: boolean; hint: string; onChange: (v: string) => void }) {
  const id = `flex-${f.key}`
  const error = invalid ? (f.unit === 'months' ? `Enter whole months from 1 to ${f.max}.` : f.unit === 'naira' ? 'Enter an amount of 0 or more.' : `Enter a rate from 0 to ${f.max}.`) : undefined
  return (
    <Field id={id} label={f.label} error={error} hint={invalid ? undefined : hint}>
      <div className={f.unit === 'naira' ? 'am-money' : 'am-pct'}>
        <input id={id} className="a-input" type="tel" inputMode={f.unit === 'pct' ? 'decimal' : 'numeric'} autoComplete="off" value={value} aria-invalid={invalid}
          onKeyDown={blockMinus} onChange={e => onChange(nonNegativeString(e.target.value))} />
        {f.unit !== 'months' && <span aria-hidden="true">{f.unit === 'pct' ? '%' : '₦'}</span>}
      </div>
    </Field>
  )
}
