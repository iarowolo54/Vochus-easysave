'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AmountField from '@/components/ui/AmountField'
import DatePicker from '@/components/ui/DatePicker'
import { FieldError } from '@/components/ui/FormErrors'
import { Icons } from '@/components/ui/icons'
import { AJO_CADENCES, MAX_SIZE, MIN_SIZE, lagosDay, lagosMidnight, potOf, roundLabel, type AjoCadence } from '@/lib/ajo'
import { formatNaira } from '@/lib/format'

const CADENCE_LABEL: Record<AjoCadence, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }
const EVERY: Record<AjoCadence, string> = { daily: 'every day', weekly: 'every week', monthly: 'every month' }
const UNIT: Record<AjoCadence, [string, string]> = { daily: ['day', 'days'], weekly: ['week', 'weeks'], monthly: ['month', 'months'] }
type Errors = Partial<Record<'name' | 'cadence' | 'size' | 'contribution' | 'startDate', string>>

export default function NewAjoGroupPage() {
  const router = useRouter()
  const today = lagosDay(new Date())
  const [name, setName] = useState('')
  const [cadence, setCadence] = useState<AjoCadence>('weekly')
  const [size, setSize] = useState('')
  const [amount, setAmount] = useState('')
  const [startDate, setStartDate] = useState(today)
  const [errors, setErrors] = useState<Errors>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const n = Number(size)
  const contribution = Number(amount.replace(/,/g, ''))
  const ready = Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE && contribution > 0
  const start = lagosMidnight(startDate)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true); setError(''); setErrors({})
    try {
      const res = await fetch('/api/agent/ajo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cadence, size: n, contribution, startDate }),
      })
      const d: { group?: { id: string }; error?: string; errors?: Errors } = await res.json().catch(() => ({}))
      if (!res.ok || !d.group) { setErrors(d.errors ?? {}); setError(d.error ?? 'The group wasn’t created. Try again.'); return }
      router.replace(`/dashboard/ajo/${d.group.id}`)
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ag-page">
      <form className="ui-card" onSubmit={submit} noValidate>
        <div className="ui-field">
          <label className="ui-label" htmlFor="ajo-name">Group name</label>
          <input id="ajo-name" className="ui-input" value={name} maxLength={60} placeholder="e.g. Oja Oba traders" autoComplete="off"
            aria-invalid={!!errors.name} onChange={e => setName(e.target.value)} />
          <FieldError id="ajo-name-error" message={errors.name} />
        </div>

        <div className="ui-field">
          <span className="ui-label" id="ajo-cad">How often members pay</span>
          <div className="ui-segment ag-seg" role="group" aria-labelledby="ajo-cad">
            {AJO_CADENCES.map(c => (
              <button key={c} type="button" aria-pressed={cadence === c} onClick={() => setCadence(c)}>{CADENCE_LABEL[c]}</button>
            ))}
          </div>
        </div>

        <div className="ui-field">
          <label className="ui-label" htmlFor="ajo-size">Number of members</label>
          <input id="ajo-size" className="ui-input" type="tel" inputMode="numeric" maxLength={2} placeholder={`${MIN_SIZE} to ${MAX_SIZE}`}
            value={size} aria-invalid={!!errors.size} onChange={e => setSize(e.target.value.replace(/\D/g, ''))} />
          {ready
            ? <p className="ui-field-hint">The group runs {n} {UNIT[cadence][n === 1 ? 0 : 1]}: one turn to redeem for each member.</p>
            : <FieldError id="ajo-size-error" message={errors.size} />}
        </div>

        <div className="ui-field">
          <span className="ui-label">Each member pays</span>
          <AmountField value={amount} onChange={setAmount} label="What each member pays each round, in naira" invalid={!!errors.contribution} />
          <FieldError id="ajo-amount-error" message={errors.contribution} />
        </div>

        <div className="ui-field">
          <label className="ui-label" htmlFor="ajo-start">First payment day</label>
          <DatePicker id="ajo-start" ariaLabel="First payment day" sheetTitle="Pick the first payment day" todayPrefix minIso={today} value={startDate} onChange={setStartDate} />
          <FieldError id="ajo-start-error" message={errors.startDate} />
        </div>

        {ready && (
          <p className="ui-note ag-ajo-summary">
            <Icons.calendar size={16} aria-hidden="true" />
            <span>Each member pays {formatNaira(contribution, { minor: false })} {EVERY[cadence]}. Every turn, one member redeems {formatNaira(potOf({ contribution, size: n }), { minor: false })}, from {roundLabel(start, cadence, 1)} to {roundLabel(start, cadence, n)}.</span>
          </p>
        )}

        {error && <p className="ui-field-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}
        <button type="submit" className="ui-btn ui-btn--primary ui-btn--block ui-gap-top" disabled={saving} aria-busy={saving}>
          {saving ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Creating…</> : 'Create group'}
        </button>
      </form>
    </div>
  )
}
