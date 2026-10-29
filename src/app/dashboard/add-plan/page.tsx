'use client'
import { useEffect, useState, Suspense, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import EmptyState from '@/components/ui/EmptyState'
import EndDateField, { endDateDays } from '@/components/ui/EndDateField'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { ListSkeleton } from '@/components/ui/Skeleton'
import Toast from '@/components/ui/Toast'
import { Icons } from '@/components/ui/icons'
import { avatarTint } from '@/lib/avatar'
import { displayName, formatDate, formatNaira } from '@/lib/format'
import { blockMinus, nonNegativeString } from '@/lib/numeric'
import { addDays, isoDate, parseDateInput, today, type Cadence } from '@/lib/plan-dates'

interface Customer {
  id: string; customerId: string; firstName: string; lastName: string; phone: string; photoUrl?: string | null
  savingsBalance: number; savingsPlans: { id: string; status: string }[]
}

const GOALS = ['School Fees', 'Business Capital', 'House Rent', 'Medical Expenses', 'Wedding / Event', 'Other']
const PERIODS: Record<Cadence, [string, string][]> = {
  daily: [['31', '31 days'], ['62', '62 days'], ['93', '93 days'], ['186', '186 days'], ['365', '365 days']],
  weekly: [['28', '4 weeks'], ['56', '8 weeks'], ['84', '12 weeks'], ['168', '24 weeks'], ['364', '52 weeks']],
  monthly: [['30', '1 month'], ['60', '2 months'], ['90', '3 months'], ['180', '6 months'], ['365', '12 months']],
}
const PER: Record<Cadence, string> = { daily: 'a day', weekly: 'a week', monthly: 'a month' }
const UNIT_DAYS: Record<Cadence, number> = { daily: 1, weekly: 7, monthly: 30 }

export default function AddPlanPage() {
  return <Suspense fallback={<div className="ag-page"><ListSkeleton count={4} /></div>}><AddPlanContent /></Suspense>
}

function AddPlanContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [touched, setTouched] = useState(false)

  const [cadence, setCadence] = useState<Cadence>('daily')
  const [amount, setAmount] = useState('')
  const [periodDays, setPeriodDays] = useState('')
  const [goal, setGoal] = useState('')
  const [startDate, setStartDate] = useState('')
  /** A chosen end date ("yyyy-mm-dd") instead of a set length. */
  const [customEnd, setCustomEnd] = useState('')
  const [notes, setNotes] = useState('')
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    const cid = searchParams.get('cid')
    if (!cid) { setLoadError('No customer was chosen.'); return }
    fetch(`/api/customers?search=${encodeURIComponent(cid)}&limit=5`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(d => {
        const c = (d.customers ?? []).find((x: Customer) => x.customerId === cid) ?? d.customers?.[0]
        if (c) setCustomer(c); else setLoadError('We couldn’t find that customer.')
      })
      .catch(() => setLoadError('No connection. Check your internet and refresh the page.'))
  }, [searchParams])

  const planStart = parseDateInput(startDate) ?? today()
  const raw = parseFloat(amount) || 0
  const days = parseInt(periodDays || '0')
  const total = raw && days ? Math.round((raw / UNIT_DAYS[cadence]) * days) : 0
  const ends = days ? addDays(planStart, days) : null
  const errs = {
    amount: !raw ? `Enter how much they’ll save ${PER[cadence]}` : '',
    period: !days ? (customEnd ? 'Pick a valid end date' : 'Choose how long the plan runs') : '',
    goal: !goal ? 'Choose what they’re saving for' : '',
  }

  function changeCadence(c: Cadence) {
    setCadence(c); setPeriodDays(''); setCustomEnd('')
  }

  async function submit() {
    if (!customer) return
    setTouched(true); setError('')
    if (errs.amount || errs.period || errs.goal) return
    if (!agreed) { setError('Confirm the customer has agreed to this plan.'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/customers/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          dailyAmount: String(raw / UNIT_DAYS[cadence]),
          periodDays: String(days), goal, cadence,
          startDate: startDate || undefined,
          notes: notes.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'The plan wasn’t created. Please try again.'); return }
      setToast(`New plan added for ${displayName(customer.firstName)}`)
      setTimeout(() => router.push(`/dashboard/savings?cid=${encodeURIComponent(customer.customerId)}`), 1200)
    } catch {
      setError('We lost the connection. Check the customer’s plans before trying again, so it isn’t added twice.')
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="ag-page ag-card-page">
        <section className="ui-card"><EmptyState icon="customers" tone="danger" title="Customer not found" text={loadError}
          action={<Link href="/dashboard/customers" className="ui-btn ui-btn--primary">Go to customers</Link>} /></section>
      </div>
    )
  }
  if (!customer) return <div className="ag-page ag-card-page"><ListSkeleton count={4} /></div>

  const activeCount = customer.savingsPlans.filter(p => p.status === 'Active').length

  return (
    <div className="ag-page ag-card-page">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      <button type="button" className="ui-link ag-back-link" onClick={() => router.back()}><Icons.back size={16} aria-hidden="true" /> Back</button>

      <section className="ui-card ag-who ag-addplan-who">
        {customer.photoUrl
          ? <img className="ui-avatar ag-av ag-chat-av" src={customer.photoUrl} alt="" />
          : <span className={`ui-avatar ag-av ag-av--${avatarTint(customer.customerId)} ag-chat-av`} aria-hidden="true">{`${customer.firstName[0] ?? ''}${customer.lastName[0] ?? ''}`.toUpperCase()}</span>}
        <div className="ag-payee-main">
          <p className="ui-row-title">{displayName(`${customer.firstName} ${customer.lastName}`)}</p>
          <p className="ui-row-sub">{customer.customerId} · {activeCount} active plan{activeCount === 1 ? '' : 's'} · {formatNaira(customer.savingsBalance, { minor: false })} saved</p>
        </div>
      </section>

      <section className="ui-card ag-addplan" aria-labelledby="addplan-title">
        <h2 id="addplan-title" className="ui-card-title ag-card-title">New savings plan</h2>

        <p className="ag-label" id="cad">How often?</p>
        <div className="ui-segment ag-seg" role="group" aria-labelledby="cad">
          {(['daily', 'weekly', 'monthly'] as const).map(c => (
            <button key={c} type="button" aria-pressed={cadence === c} onClick={() => changeCadence(c)}>{c === 'daily' ? 'Daily' : c === 'weekly' ? 'Weekly' : 'Monthly'}</button>
          ))}
        </div>

        <div className="ag-grid-2">
          <Field id="ap-amt" label={`Amount ${PER[cadence]}`} error={touched ? errs.amount : ''}>
            <span className="ag-tf-money">
              <span aria-hidden="true">₦</span>
              <input id="ap-amt" className="ag-tf-input ag-tf-num" type="tel" inputMode="decimal" onKeyDown={blockMinus}
                placeholder={cadence === 'weekly' ? '3,500' : cadence === 'monthly' ? '15,000' : '500'}
                value={amount} onChange={e => setAmount(nonNegativeString(e.target.value))} />
            </span>
          </Field>
          <Field id="ap-per" label="For how long" error={touched && !customEnd ? errs.period : ''}>
            <select id="ap-per" className="ag-tf-input ag-tf-select" value={customEnd ? 'custom' : periodDays} onChange={e => {
              if (e.target.value === 'custom') {
                const end = isoDate(addDays(planStart, parseInt(periodDays || PERIODS[cadence][1][0])))
                setCustomEnd(end)
                setPeriodDays(String(endDateDays(end, planStart, cadence) ?? ''))
              } else { setCustomEnd(''); setPeriodDays(e.target.value) }
            }}>
              <option value="">Choose</option>
              {PERIODS[cadence].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              <option value="custom">Choose an end date…</option>
            </select>
          </Field>
        </div>
        {customEnd && (
          <EndDateField start={planStart} cadence={cadence} value={customEnd}
            onChange={(v, d) => { setCustomEnd(v); setPeriodDays(d ? String(d) : '') }} />
        )}

        <p className="ag-label" id="goal-l">What are they saving for?</p>
        <div className="ag-goal-chips" role="group" aria-labelledby="goal-l">
          {GOALS.map(g => <button key={g} type="button" className="ag-chip" aria-pressed={goal === g} onClick={() => setGoal(g)}>{g}</button>)}
        </div>
        {touched && errs.goal && <FieldError id="goal-error" message={errs.goal} />}

        <div className="ag-grid-2">
          <Field id="ap-start" label="Start date" hint="Leave empty to start today.">
            <input id="ap-start" className="ag-tf-input" type="date" value={startDate} onChange={e => {
              setStartDate(e.target.value)
              // Keep a chosen end date where it is; the length changes instead.
              if (customEnd) setPeriodDays(String(endDateDays(customEnd, parseDateInput(e.target.value) ?? today(), cadence) ?? ''))
            }} />
          </Field>
          <Field id="ap-note" label="Note (optional)">
            <input id="ap-note" className="ag-tf-input" maxLength={200} placeholder="e.g. Saving for the wedding" value={notes} onChange={e => setNotes(e.target.value)} />
          </Field>
        </div>

        {total > 0 && ends && (
          <div className="ag-target">
            <span className="ui-row-sub ui-block">They’ll have saved</span>
            <span className="ag-target-amount">{formatNaira(total, { minor: false })}</span>
            <span className="ui-row-sub ui-block">by {formatDate(ends)}. A platform fee is taken when they collect.</span>
          </div>
        )}

        <button type="button" role="checkbox" aria-checked={agreed} className={`ag-agree${agreed ? ' is-on' : ''}`} onClick={() => { setAgreed(a => !a); setError('') }}>
          <span className="ag-agree-box" aria-hidden="true">{agreed && <Icons.check size={16} />}</span>
          <span>The customer has agreed to this plan and its terms, including the platform fee.</span>
        </button>

        <FormError message={error} />
        <div className="ui-stack ag-addplan-actions">
          <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={saving} onClick={submit}>
            {saving ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Creating…</> : 'Create plan'}
          </button>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={saving} onClick={() => router.back()}>Cancel</button>
        </div>
      </section>
    </div>
  )
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="ag-tf-wrap">
      <div className={`ag-tf${error ? ' is-invalid' : ''}`}>
        <label className="ag-tf-label" htmlFor={id}>{label}</label>
        {children}
      </div>
      {error ? <FieldError id={`${id}-error`} message={error} /> : hint ? <p className="ag-fineprint">{hint}</p> : null}
    </div>
  )
}
