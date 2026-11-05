'use client'
import { useEffect, useState, Suspense, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import TransferPanel, { type TransferDetails } from '@/components/ui/TransferPanel'
import CustomerBottomNav from '@/components/customer/CustomerBottomNav'
import { useCustomerMe } from '@/components/customer/useCustomerMe'
import Amount from '@/components/ui/Amount'
import BottomSheet from '@/components/ui/BottomSheet'
import EmptyState from '@/components/ui/EmptyState'
import EndDateField, { endDateDays } from '@/components/ui/EndDateField'
import DatePicker from '@/components/ui/DatePicker'
import { FormSkeleton } from '@/components/ui/Skeleton'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { Icons } from '@/components/ui/icons'
import { formatDate, formatNaira } from '@/lib/format'
import { describeFailure, postJson } from '@/lib/http'
import { blockMinus, nonNegativeString } from '@/lib/numeric'
import { addDays, isoDate, lengthLabel, parseDateInput, today } from '@/lib/plan-dates'

type Cadence = 'daily' | 'weekly' | 'monthly'

const DURATIONS: Record<Cadence, { days: number; name: string; desc: string; popular?: boolean }[]> = {
  daily: [
    { days: 31,  name: '31 days',  desc: 'Short-term' },
    { days: 62,  name: '62 days',  desc: 'Most popular', popular: true },
    { days: 93,  name: '93 days',  desc: 'Medium-term' },
    { days: 186, name: '186 days', desc: 'Long-term' },
    { days: 365, name: '365 days', desc: 'Full year' },
  ],
  weekly: [
    { days: 28,  name: '4 weeks',  desc: 'Short-term' },
    { days: 56,  name: '8 weeks',  desc: 'Most popular', popular: true },
    { days: 84,  name: '12 weeks', desc: 'Medium-term' },
    { days: 168, name: '24 weeks', desc: 'Long-term' },
    { days: 364, name: '52 weeks', desc: 'Full year' },
  ],
  monthly: [
    { days: 30,  name: '1 month',   desc: 'Short-term' },
    { days: 60,  name: '2 months',  desc: 'Most popular', popular: true },
    { days: 90,  name: '3 months',  desc: 'Medium-term' },
    { days: 180, name: '6 months',  desc: 'Long-term' },
    { days: 365, name: '12 months', desc: 'Full year' },
  ],
}

const DEFAULT_DAYS: Record<Cadence, number> = { daily: 62, weekly: 56, monthly: 60 }
const MINIMUM: Record<Cadence, number> = { daily: 100, weekly: 1000, monthly: 3000 }
const UNIT: Record<Cadence, string> = { daily: 'day', weekly: 'week', monthly: 'month' }
const ADJ: Record<Cadence, string> = { daily: 'daily', weekly: 'weekly', monthly: 'monthly' }

const GOALS = [
  'General Savings', 'School Fees', 'Business Capital', 'House Rent / Building',
  'Medical Expenses', 'Wedding / Event', 'Farm / Agriculture',
]

type Plan = {
  id: string; dailyAmount: number; periodDays: number; cadence?: string; goal: string
  startDate: string; maturityDate: string; balance: number; status: string
}
type Me = {
  plan: Plan | null
  plans: Plan[]
  pendingRedemptions: { ref: string; status: string; savingsPlanId: string }[]
}

function cadenceOf(p: Plan): Cadence {
  return p.cadence === 'weekly' || p.cadence === 'monthly' ? p.cadence : 'daily'
}

/** The plan's own amount per day/week/month — the only amount this screen pays (unchanged behaviour). */
function periodAmount(p: Plan) {
  const c = cadenceOf(p)
  return Math.round(c === 'weekly' ? p.dailyAmount * 7 : c === 'monthly' ? p.dailyAmount * 30 : p.dailyAmount)
}

function SavePageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const paramPlanId = params.get('planId')
  const forceNew = params.get('new') === '1'

  const { data, loading, failed, reload } = useCustomerMe<Me>()
  const [plans, setPlans] = useState<Plan[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(paramPlanId)
  const [mode, setMode] = useState<'pay' | 'new'>(forceNew ? 'new' : 'pay')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState('')
  const [paying, setPaying] = useState(false)
  const [transfer, setTransfer] = useState<TransferDetails | null>(null)

  // New-plan form
  const [cadence, setCadence] = useState<Cadence>('daily')
  const [amountText, setAmountText] = useState('500')
  const [periodDays, setPeriodDays] = useState(DEFAULT_DAYS.daily)
  /** A chosen end date ("yyyy-mm-dd") instead of a set length; "" when a set length is picked. */
  const [customEnd, setCustomEnd] = useState('')
  /** The plan's start date ("yyyy-mm-dd"); "" means today. */
  const [planStart, setPlanStart] = useState('')
  const [goal, setGoal] = useState('General Savings')
  const [amountError, setAmountError] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!data) return
    const all = data.plans ?? (data.plan ? [data.plan] : [])
    setPlans(all)
    setSelectedPlanId(id => (id && all.some(p => p.id === id) ? id : all[0]?.id ?? null))
    if (all.length === 0) setMode('new')
  }, [data])

  const selectedPlan = plans.find(p => p.id === selectedPlanId) ?? null
  const pending = data?.pendingRedemptions.find(r => r.savingsPlanId === selectedPlanId) ?? null

  function choosePlan(id: string) {
    setSelectedPlanId(id)
    setPickerOpen(false)
    setError('')
  }

  function goBack() {
    setMode('pay')
    setError('')
  }

  async function pay() {
    setError('')
    if (!selectedPlan) { setError('Choose a savings plan first.'); return }
    setPaying(true)
    const result = await postJson<TransferDetails>('/api/customer/transfer/init', {
      amount: periodAmount(selectedPlan), planId: selectedPlan.id,
    })
    setPaying(false)
    if (result.ok) { setTransfer(result.data); return }
    setError(describeFailure(result))
  }

  async function createPlan(e: FormEvent) {
    e.preventDefault()
    setError('')
    const raw = parseFloat(amountText)
    if (!raw || raw < MINIMUM[cadence]) {
      setAmountError(`The minimum is ${formatNaira(MINIMUM[cadence], { minor: false })} a ${UNIT[cadence]}.`)
      document.getElementById('plan-amount')?.focus()
      return
    }
    if (customEnd && endDateDays(customEnd, parseDateInput(planStart) ?? today(), cadence) === null) {
      setError('Pick a valid end date for your plan.')
      return
    }
    const dailyAmount = cadence === 'weekly' ? raw / 7 : cadence === 'monthly' ? raw / 30 : raw
    setCreating(true)
    const result = await postJson<{ plan: Plan }>('/api/customer/plan', { dailyAmount, periodDays, goal, cadence, ...(planStart ? { startDate: planStart } : {}) })
    setCreating(false)
    if (!result.ok) { setError(describeFailure(result)); return }
    setPlans(prev => [result.data.plan, ...prev])
    setSelectedPlanId(result.data.plan.id)
    setMode('pay')
  }

  if (loading) return <FormSkeleton label="Loading your plans" />

  if (failed || !data) return (
    <div className="ui-screen ui-screen--center">
      {failed && (
        <EmptyState
          icon="error"
          tone="danger"
          title="We couldn't load your plans"
          text="Check your connection and try again."
          action={<button type="button" className="ui-btn ui-btn--primary" onClick={reload}><Icons.retry size={18} aria-hidden="true" /> Try again</button>}
        />
      )}
    </div>
  )

  const raw = parseFloat(amountText) || 0
  const dailyEquiv = cadence === 'weekly' ? raw / 7 : cadence === 'monthly' ? raw / 30 : raw
  const startDay = parseDateInput(planStart) ?? today()
  const finishDate = addDays(startDay, periodDays)
  const duration = DURATIONS[cadence].find(d => d.days === periodDays)

  return (
    <div className="ui-screen">
      <header className="ui-topbar">
        {mode === 'new' && plans.length > 0 && (
          <button type="button" className="ui-icon-btn" onClick={goBack} aria-label="Back to saving">
            <Icons.back size={22} aria-hidden="true" />
          </button>
        )}
        <div className="ui-topbar-main">
          <h1 className={mode === 'new' && plans.length > 0 ? 'ui-topbar-title' : 'ui-page-title'}>{mode === 'new' ? 'New savings plan' : 'Save'}</h1>
        </div>
      </header>

      <main className="ui-container">
        {mode === 'pay' && selectedPlan && pending && (
          <EmptyState
            icon="locked"
            title="Saving is paused for this plan"
            text="You have a collection in progress. You can save into this plan again once it's finished."
            action={
              <div className="ui-stack">
                <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => router.push('/customer/redeem')}>View collection</button>
                {plans.length > 1 && (
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => setPickerOpen(true)}>Save into another plan</button>
                )}
              </div>
            }
          />
        )}

        {mode === 'pay' && selectedPlan && !pending && transfer && (
          <TransferPanel
            details={transfer}
            statusUrl="/api/customer/transfer/status"
            cancelUrl="/api/customer/transfer/cancel"
            reportUrl="/api/customer/transfer/report-kobo"
            destination={selectedPlan.goal}
            balanceLabel="Your balance"
            doneHref="/customer/dashboard"
            historyHref="/customer/transactions"
            onClose={() => setTransfer(null)}
          />
        )}

        {mode === 'pay' && selectedPlan && !pending && !transfer && (
          <>
            {/* Review layout (Cash App style): the sentence says exactly what will happen before the account details show. */}
            <section className="ui-review" aria-label="Payment summary">
              <p className="ui-review-kicker">Your {ADJ[cadenceOf(selectedPlan)]} savings</p>
              <h2 className="ui-review-title">
                Save {formatNaira(periodAmount(selectedPlan), { minor: false })} into {selectedPlan.goal}
              </h2>
            </section>

            <dl className="ui-card ui-card--list ui-review-rows">
              <div className="ui-row">
                <dt className="ui-row-main ui-row-sub">To</dt>
                <dd className="ui-review-value">
                  {selectedPlan.goal}
                  {plans.length > 1 && (
                    <button type="button" className="ui-link" onClick={() => setPickerOpen(true)}>Change</button>
                  )}
                </dd>
              </div>
              <div className="ui-row">
                <dt className="ui-row-main ui-row-sub">You’ll send</dt>
                <dd className="ui-review-value ui-amount">{formatNaira(periodAmount(selectedPlan), { minor: false })} <span className="tp-kobo-hint">+ a few kobo</span></dd>
              </div>
              <div className="ui-row">
                <dt className="ui-row-main ui-row-sub">Pay with</dt>
                <dd className="ui-review-value">Bank transfer<span className="ui-row-sub ui-block">To our Moniepoint account</span></dd>
              </div>
            </dl>

            <FormError message={error} />

            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={pay} disabled={paying} aria-busy={paying}>
              {paying ? 'Getting account details…' : 'Get account and exact amount'}
            </button>
            <div className="tp-callout tp-callout--pre">
              <p className="tp-callout-title">Next you’ll see the exact amount</p>
              <p className="tp-callout-text">It has a few extra kobo, like {formatNaira(periodAmount(selectedPlan) + 0.37)}. Send it exactly, kobo included, so we can tell the payment is yours. The kobo is not a fee. All of it goes into your savings.</p>
            </div>

            <button type="button" className="ui-btn ui-btn--secondary ui-btn--block ui-gap-top" onClick={() => { setMode('new'); setError('') }}>
              <Icons.add size={18} aria-hidden="true" /> Start a new plan
            </button>
          </>
        )}

        {mode === 'new' && (
          <form onSubmit={createPlan} noValidate className="ui-gap-top">
            <div className="ui-field">
              <p className="ui-label" id="cadence-label">How often will you save?</p>
              <div className="ui-segment" role="group" aria-labelledby="cadence-label">
                {(['daily', 'weekly', 'monthly'] as const).map(c => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={cadence === c}
                    onClick={() => { setCadence(c); setPeriodDays(DEFAULT_DAYS[c]); setCustomEnd(''); setAmountError('') }}
                  >
                    {c[0].toUpperCase() + c.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="ui-field">
              <label className="ui-label" htmlFor="plan-amount">How much each {UNIT[cadence]}?</label>
              <div className="ui-input-wrap">
                <span className="ui-input-prefix" aria-hidden="true">₦</span>
                <input
                  id="plan-amount"
                  className="ui-input ui-input--number ui-input--prefixed"
                  value={amountText}
                  onChange={e => { setAmountText(nonNegativeString(e.target.value)); setAmountError('') }}
                  onKeyDown={blockMinus}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-invalid={!!amountError}
                  aria-describedby={amountError ? 'plan-amount-error' : 'plan-amount-hint'}
                />
              </div>
              {amountError
                ? <FieldError id="plan-amount-error" message={amountError} />
                : <p id="plan-amount-hint" className="ui-field-hint">Minimum {formatNaira(MINIMUM[cadence], { minor: false })} a {UNIT[cadence]}</p>}
            </div>

            <div className="ui-field">
              <label className="ui-label" htmlFor="plan-start">Starts on</label>
              <DatePicker id="plan-start" ariaLabel="Plan start date" sheetTitle="Pick a start date" todayPrefix
                minIso={isoDate(today())} value={planStart || isoDate(today())}
                onChange={iso => {
                  const v = iso === isoDate(today()) ? '' : iso
                  setPlanStart(v)
                  // Keep a chosen end date where it is; the length changes instead.
                  if (customEnd) { const d = endDateDays(customEnd, parseDateInput(v) ?? today(), cadence); if (d) setPeriodDays(d) }
                }} />
              <p className="ui-field-hint">{planStart ? `Your plan starts on ${formatDate(startDay)}.` : 'Starts today. Pick a later day if you’d rather.'}</p>
            </div>

            <div className="ui-field">
              <p className="ui-label" id="duration-label">For how long?</p>
              <div className="ui-card ui-card--list" role="radiogroup" aria-labelledby="duration-label">
                {DURATIONS[cadence].map(d => (
                  <button
                    key={d.days}
                    type="button"
                    role="radio"
                    aria-checked={!customEnd && d.days === periodDays}
                    className="ui-option ui-radio-row"
                    onClick={() => { setPeriodDays(d.days); setCustomEnd('') }}
                  >
                    <span className="ui-radio" aria-hidden="true" />
                    <span className="ui-row-main">
                      <span className="ui-row-title ui-block">
                        {d.name} {d.popular && <span className="ui-badge">Most popular</span>}
                      </span>
                      <span className="ui-row-sub ui-block">{d.popular ? 'Our most chosen length' : d.desc}</span>
                    </span>
                    <span className="ui-row-value">{formatNaira(Math.round(dailyEquiv * d.days), { minor: false })}</span>
                  </button>
                ))}
                <button type="button" role="radio" aria-checked={!!customEnd} className="ui-option ui-radio-row"
                  onClick={() => { if (!customEnd) setCustomEnd(isoDate(addDays(startDay, periodDays))) }}>
                  <span className="ui-radio" aria-hidden="true" />
                  <span className="ui-row-main">
                    <span className="ui-row-title ui-block">Choose an end date</span>
                    <span className="ui-row-sub ui-block">{customEnd ? lengthLabel(periodDays, cadence) : 'Pick the day you want to collect'}</span>
                  </span>
                  {customEnd && <span className="ui-row-value">{formatNaira(Math.round(dailyEquiv * periodDays), { minor: false })}</span>}
                </button>
              </div>
              {customEnd && (
                <div className="cu-enddate">
                  <EndDateField picker start={startDay} cadence={cadence} value={customEnd}
                    onChange={(v, days) => { setCustomEnd(v); if (days) setPeriodDays(days) }} />
                </div>
              )}
            </div>

            <div className="ui-field">
              <label className="ui-label" htmlFor="plan-goal">What is it for?</label>
              <select id="plan-goal" className="ui-input ui-select" value={goal} onChange={e => setGoal(e.target.value)}>
                {GOALS.map(g => <option key={g}>{g}</option>)}
              </select>
            </div>

            {raw > 0 && (
              <section className="ui-card ui-plan-summary" aria-label="Plan summary">
                <span className="ui-row-sub">You’ll have</span>
                <span className="ui-amount ui-plan-summary-amount">{formatNaira(Math.round(dailyEquiv * periodDays), { minor: false })}</span>
                <span className="ui-row-sub">
                  by <strong>{formatDate(finishDate)}</strong> · {formatNaira(raw, { minor: false })} a {UNIT[cadence]} for {duration && !customEnd ? duration.name : lengthLabel(periodDays, cadence)}
                </span>
              </section>
            )}

            <FormError message={error} />

            <button type="submit" className="ui-btn ui-btn--primary ui-btn--block" disabled={creating} aria-busy={creating}>
              {creating ? 'Creating your plan…' : 'Start my plan'}
            </button>
          </form>
        )}
      </main>

      <BottomSheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Save into">
        <div>
          {plans.map(p => {
            const locked = data.pendingRedemptions.some(r => r.savingsPlanId === p.id)
            return (
              <button
                key={p.id}
                type="button"
                className="ui-option"
                aria-current={p.id === selectedPlanId ? 'true' : undefined}
                onClick={() => choosePlan(p.id)}
              >
                <span className="ui-row-main">
                  <span className="ui-row-title ui-block">{p.goal}</span>
                  <span className="ui-row-sub ui-block">
                    {locked ? 'Collection in progress' : `${formatNaira(periodAmount(p), { minor: false })} a ${UNIT[cadenceOf(p)]}`}
                  </span>
                </span>
                <span className="ui-row-value">{formatNaira(p.balance)}</span>
                <span className="ui-option-check" aria-hidden="true">{p.id === selectedPlanId && <Icons.check size={20} />}</span>
              </button>
            )
          })}
        </div>
      </BottomSheet>

      <CustomerBottomNav />
    </div>
  )
}

export default function CustomerSavePage() {
  return (
    <Suspense>
      <SavePageInner />
    </Suspense>
  )
}
