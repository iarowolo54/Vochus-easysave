'use client'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CatchupCalendar } from '@/components/customer/SavingsCard'
import { useCustomerMe } from '@/components/customer/useCustomerMe'
import EmptyState from '@/components/ui/EmptyState'
import { FormError } from '@/components/ui/FormErrors'
import { Icons } from '@/components/ui/icons'
import { FormSkeleton } from '@/components/ui/Skeleton'
import { MAX_CATCHUP_KEYS, isEligiblePlan, perSlotAmount, selectableKeys, selectionTotal } from '@/lib/catchup'
import { formatNaira } from '@/lib/format'
import { describeFailure, postJson } from '@/lib/http'
import { getHideBalance } from '@/lib/preferences'
import { buildSlots, hasEnded, isWeekly } from '@/lib/savings-card'

type Plan = {
  id: string; dailyAmount: number; periodDays: number; cadence?: string; goal: string
  startDate: string; maturityDate: string; balance: number; status: string; source?: string
  coveredKeys?: string[]
}
type Tx = { id: string; amount: number; createdAt: string; method: string | null; planId: string | null; recordedBy: string }
type Me = { plan: Plan | null; plans?: Plan[]; transactions: Tx[] }

function CatchupScreen() {
  const router = useRouter()
  const params = useSearchParams()
  const { data, loading, failed, reload } = useCustomerMe<Me>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')
  const [hide] = useState(() => (typeof window === 'undefined' ? false : getHideBalance()))

  const planId = params.get('planId')
  const plans = data ? data.plans ?? (data.plan ? [data.plan] : []) : []
  const plan = plans.find(p => p.id === planId) ?? null
  const deposits = useMemo(() => (data && plan ? data.transactions.filter(t => t.planId === plan.id) : []), [data, plan])
  const slots = useMemo(
    () => (plan ? buildSlots(plan, deposits.map(d => d.createdAt), plan.coveredKeys ?? []) : []),
    [plan, deposits],
  )
  const selectable = useMemo(() => new Set(selectableKeys(slots)), [slots])

  // Returning from Paystack via the back/forward cache restores this page with `paying` still true.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setPaying(false) }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  const back = () => router.push('/customer/dashboard')

  const header = (
    <header className="ui-topbar">
      <button type="button" className="ui-icon-btn" onClick={back} aria-label="Back to home">
        <Icons.back size={22} aria-hidden="true" />
      </button>
      <div className="ui-topbar-main"><h1 className="ui-topbar-title">Catch up</h1></div>
    </header>
  )

  if (loading) return <FormSkeleton label="Loading your savings card" />

  if (failed) return (
    <div className="ui-screen ui-screen--center">
      <EmptyState
        icon="error"
        tone="danger"
        title="We couldn't load your savings"
        text="Check your connection and try again."
        action={
          <button type="button" className="ui-btn ui-btn--primary" onClick={reload}>
            <Icons.retry size={18} aria-hidden="true" /> Try again
          </button>
        }
      />
    </div>
  )

  if (!data) return null

  const blocked = !plan || !isEligiblePlan({ status: plan.status, source: plan.source ?? '', cadence: plan.cadence }) || hasEnded(plan)
  if (!plan || blocked || selectable.size === 0) {
    return (
      <div className="ui-screen">
        {header}
        <main className="ui-container">
          <section className="ui-card">
            <EmptyState
              icon="check"
              title={blocked ? 'Catch-up isn’t available for this plan' : 'You’re all caught up'}
              text={blocked ? 'You can only catch up on a running daily or weekly plan.' : 'You have no missed days to pay for.'}
              action={<button type="button" className="ui-btn ui-btn--primary" onClick={back}>Back to home</button>}
            />
          </section>
        </main>
      </div>
    )
  }

  const unit = isWeekly(plan) ? 'week' : 'day'
  const count = selected.size
  const total = selectionTotal(plan, count)
  const perSlot = perSlotAmount(plan)
  const atCap = count >= MAX_CATCHUP_KEYS

  function toggle(key: string) {
    if (paying || !selectable.has(key)) return
    setError('')
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else if (next.size < MAX_CATCHUP_KEYS) next.add(key)
      return next
    })
  }

  const allChosen = count > 0 && count >= Math.min(selectable.size, MAX_CATCHUP_KEYS)

  function selectAll() {
    setError('')
    setSelected(allChosen ? new Set() : new Set([...selectable].slice(0, MAX_CATCHUP_KEYS)))
  }

  async function pay() {
    if (!plan || count === 0 || paying) return
    setPaying(true)
    setError('')
    const result = await postJson<{ authorizationUrl: string }>('/api/customer/catchup/init', { planId: plan.id, keys: [...selected] })
    if (result.ok && result.data?.authorizationUrl) {
      window.location.href = result.data.authorizationUrl
      return
    }
    setPaying(false)
    setError(result.ok ? 'Something went wrong. Please try again.' : describeFailure(result))
  }

  return (
    <div className="ui-screen">
      {header}
      <main className="ui-container">
        <section className="ui-card">
          <p className="ui-card-status ui-card-status--neutral">
            Tap the {unit}s you missed, then pay for them now. {hide ? '' : `Each ${unit} is ${formatNaira(perSlot, { minor: false })}. `}
            The money is added to your savings today.
          </p>
          <CatchupCalendar plan={plan} deposits={deposits} selectable={selectable} selected={selected} onToggle={toggle} />
          <button type="button" className="ui-link" onClick={selectAll} disabled={paying}>
            {allChosen ? 'Clear selection' : `Select all missed ${unit}s (${Math.min(selectable.size, MAX_CATCHUP_KEYS)})`}
          </button>
          <p className="ui-catchup-legend">Dashed {unit}s are missed: tap to pay. Green {unit}s are already paid. A tick means selected.</p>
        </section>

        <FormError message={error} />

        <div className="ui-catchup-bar">
          <div className="ui-catchup-sum" aria-live="polite">
            <span>{count} {unit}{count === 1 ? '' : 's'} selected</span>
            <strong>{hide ? '₦ ••••' : formatNaira(total)}</strong>
          </div>
          {atCap && <p className="ui-catchup-note">You can catch up on up to {MAX_CATCHUP_KEYS} {unit}s at a time.</p>}
          <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={pay} disabled={count === 0 || paying}>
            {paying ? 'Opening payment…' : count === 0 ? `Select a ${unit} to pay` : hide ? 'Pay by card' : `Pay ${formatNaira(total)} by card`}
          </button>
          <p className="ui-catchup-note">You’ll enter your card details on the next screen.</p>
        </div>
      </main>
    </div>
  )
}

export default function CatchupPage() {
  return (
    <Suspense fallback={<FormSkeleton label="Loading" />}>
      <CatchupScreen />
    </Suspense>
  )
}
