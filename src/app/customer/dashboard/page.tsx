'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import BottomNav from '@/components/BottomNav'
import { CUSTOMER_NAV } from '@/components/nav-items'
import CollectionTracker from '@/components/customer/CollectionTracker'
import SavingsCard from '@/components/customer/SavingsCard'
import TodayStatus from '@/components/customer/TodayStatus'
import { useCustomerMe } from '@/components/customer/useCustomerMe'
import ActionButton from '@/components/ui/ActionButton'
import BottomSheet from '@/components/ui/BottomSheet'
import Amount from '@/components/ui/Amount'
import EmptyState from '@/components/ui/EmptyState'
import ListRow from '@/components/ui/ListRow'
import { Icons } from '@/components/ui/icons'
import { displayName, formatDate, formatNaira } from '@/lib/format'
import { getHideBalance, setHideBalance } from '@/lib/preferences'
import { dateKey, hasEnded, isWeekly } from '@/lib/savings-card'

type Plan = {
  id: string; dailyAmount: number; periodDays: number; cadence?: string; goal: string
  startDate: string; maturityDate: string; balance: number; status: string
}
type Tx = {
  id: string; amount: number; ref: string; createdAt: string; method: string | null
  planId: string | null; recordedBy: string
}
type CustomerData = {
  customerId: string; name: string; phone: string; email: string | null; photoUrl: string | null
  agent: { name: string; agentId: string; phone: string }
  plan: Plan | null
  plans: Plan[]
  transactions: Tx[]
  pendingRedemptions: { ref: string; status: string; savingsPlanId: string }[]
}

function capitalise(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

function daysUntil(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))
}

export default function CustomerDashboard() {
  const router = useRouter()
  const { data, loading, failed, reload } = useCustomerMe<CustomerData>()
  const [activePlanIdx, setActivePlanIdx] = useState(0)
  const [hideBalance, setHide] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => { setHide(getHideBalance()) }, [])

  useEffect(() => {
    if (!data) return
    const w = window as unknown as {
      __vochusCanBiometric?: boolean
      __vochusBiometricEnrolled?: boolean
      __vochusDeviceId?: string
      VochusBiometric?: { postMessage: (s: string) => void }
    }
    if (!w.__vochusCanBiometric || w.__vochusBiometricEnrolled || !w.VochusBiometric) return
    ;(async () => {
      try {
        const r = await fetch('/api/customer/auth/biometric/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: w.__vochusDeviceId ?? '' }),
        })
        if (!r.ok) return
        const d = await r.json()
        w.VochusBiometric!.postMessage(JSON.stringify({ token: d.token, identifier: d.identifier }))
      } catch {}
    })()
  }, [data])

  const plans = data ? data.plans ?? (data.plan ? [data.plan] : []) : []
  const plan = plans[activePlanIdx] ?? null
  const planTxs = useMemo(
    () => (data && plan ? data.transactions.filter(t => t.planId === plan.id) : []),
    [data, plan],
  )
  const depositDates = useMemo(() => planTxs.map(t => t.createdAt), [planTxs])

  function toggleBalance() {
    setHide(h => { setHideBalance(!h); return !h })
  }

  function choosePlan(i: number) {
    setActivePlanIdx(i)
    setPickerOpen(false)
  }

  if (loading) return (
    <div className="ui-screen ui-screen--center" role="status" aria-label="Loading your savings">
      <div className="ui-spinner" />
    </div>
  )

  if (failed) return (
    <div className="ui-screen ui-screen--center">
      <EmptyState
        icon="error"
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

  const weekly = plan ? isWeekly(plan) : false
  const ended = plan ? hasEnded(plan) : false
  const pending = plan ? data.pendingRedemptions.find(r => r.savingsPlanId === plan.id) ?? null : null
  const target = plan ? plan.dailyAmount * plan.periodDays : 0
  const firstName = displayName(data.name).split(' ')[0]
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // Deposits that count for "today" — or, on a weekly plan, the plan's current week (same window as the card).
  const today = dateKey(new Date())
  let windowStart = today
  if (plan && weekly) {
    const start = new Date(plan.startDate)
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const daysIn = Math.max(0, Math.floor((Date.now() - startDay.getTime()) / 86400000))
    windowStart = dateKey(new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + daysIn - (daysIn % 7)))
  }
  const recentForStatus = planTxs.filter(t => {
    const k = dateKey(new Date(t.createdAt))
    return k >= windowStart && k <= today
  })

  const rate = plan
    ? weekly
      ? `${formatNaira(plan.dailyAmount * 7, { minor: false })} weekly`
      : `${formatNaira(plan.dailyAmount, { minor: false })} daily`
    : ''

  return (
    <div className="ui-screen">
      <header className="ui-topbar">
        {data.photoUrl
          ? <img src={data.photoUrl} className="ui-avatar" alt="" />
          : <span className="ui-avatar" aria-hidden="true">{data.name[0]}</span>}
        <div className="ui-topbar-main">
          <div className="ui-topbar-title">{greeting}, {firstName}</div>
        </div>
      </header>

      <main className="ui-container">
        <section className="ui-hero" aria-label="Savings balance">
          <div className="ui-hero-top">
            {plans.length > 1 ? (
              <button
                type="button"
                className="ui-plan-picker"
                onClick={() => setPickerOpen(true)}
                aria-haspopup="dialog"
                aria-label={`${plan?.goal ?? 'Plan'}. Change plan`}
              >
                {plan?.goal} <Icons.expand size={18} aria-hidden="true" />
              </button>
            ) : (
              <span className="ui-plan-name">{plan ? plan.goal : 'Savings balance'}</span>
            )}
            <button
              type="button"
              className="ui-icon-btn ui-icon-btn--plain"
              onClick={toggleBalance}
              aria-label={hideBalance ? 'Show balance' : 'Hide balance'}
              aria-pressed={hideBalance}
            >
              {hideBalance ? <Icons.show size={18} aria-hidden="true" /> : <Icons.hide size={18} aria-hidden="true" />}
            </button>
          </div>
          {hideBalance
            ? <span className="ui-amount ui-amount--hero" aria-label="Balance hidden">₦ ••••</span>
            : <Amount value={plan?.balance ?? 0} size="hero" animate />}
          <div className="ui-hero-sub">
            {!plan && 'No active plan yet'}
            {plan && ended && 'Plan complete'}
            {plan && !ended && (
              <>
                {rate}
                <br />
                You collect on <strong>{formatDate(plan.maturityDate)}</strong> ({daysUntil(plan.maturityDate)} days)
              </>
            )}
          </div>
          {plan && !ended && !pending && <TodayStatus weekly={weekly} deposits={recentForStatus} />}
        </section>

        {plan && ended && !pending && (
          <section className="ui-card ui-card--highlight" aria-label="Plan complete">
            <h2 className="ui-card-title">Your plan is complete</h2>
            <p className="ui-card-text">
              {hideBalance ? 'Your savings are ready to collect.' : <>You can now collect <strong>{formatNaira(plan.balance)}</strong>.</>}
            </p>
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => router.push('/customer/redeem')}>
              Collect money
            </button>
          </section>
        )}

        {pending && <CollectionTracker status={pending.status} onView={() => router.push('/customer/redeem')} />}

        <div className="ui-actions">
          {!ended && (
            <ActionButton
              icon={pending ? 'locked' : 'add'}
              label={pending ? 'Locked' : 'Save'}
              disabled={!!pending}
              onClick={() => router.push(plan ? `/customer/save?planId=${plan.id}` : '/customer/save')}
            />
          )}
          {/* A finished plan already has a big "Collect money" button above. */}
          {!ended && <ActionButton icon="withdraw" label="Collect" onClick={() => router.push('/customer/redeem')} />}
          <ActionButton
            icon="plan"
            label="New plan"
            disabled={!!pending}
            onClick={() => router.push('/customer/save?new=1')}
          />
        </div>

        {plan && <SavingsCard plan={plan} depositDates={depositDates} hideAmounts={hideBalance} />}

        <div className="ui-section-head">
          <h2>Recent savings</h2>
          {planTxs.length > 0 && (
            <button type="button" className="ui-link" onClick={() => router.push('/customer/transactions')}>
              See all <Icons.next size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <section className="ui-card ui-card--list">
          {planTxs.length === 0 ? (
            <EmptyState icon="history" title="No savings yet" text="Your deposits will show up here." />
          ) : (
            planTxs.slice(0, 5).map(tx => (
              <ListRow
                key={tx.id}
                icon="deposit"
                title="Savings deposit"
                sub={`${formatDate(tx.createdAt)} · ${capitalise(tx.method ?? 'Cash')} · ${tx.recordedBy}`}
                value={<Amount value={tx.amount} incoming />}
              />
            ))
          )}
        </section>

        <div className="ui-section-head">
          <h2>Your agent</h2>
        </div>
        <section className="ui-card ui-card--list">
          <ListRow
            leading={<span className="ui-avatar" aria-hidden="true">{data.agent.name[0]}</span>}
            title={displayName(data.agent.name)}
            sub={`Agent ID ${data.agent.agentId}`}
          />
          <div className="ui-btn-row">
            <a className="ui-btn ui-btn--secondary" href={`tel:${data.agent.phone}`}>
              <Icons.phone size={18} aria-hidden="true" /> Call
            </a>
            <button type="button" className="ui-btn ui-btn--secondary" onClick={() => router.push('/customer/chat')}>
              <Icons.chat size={18} aria-hidden="true" /> Chat
            </button>
          </div>
        </section>
      </main>

      <BottomSheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Your plans">
        <div>
          {plans.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="ui-option"
              aria-current={i === activePlanIdx ? 'true' : undefined}
              onClick={() => choosePlan(i)}
            >
              <span className="ui-row-icon" aria-hidden="true"><Icons.plan size={20} /></span>
              <span className="ui-row-main">
                <span className="ui-row-title" style={{ display: 'block' }}>{p.goal}</span>
                <span className="ui-row-sub" style={{ display: 'block' }}>{hasEnded(p) ? 'Complete' : `Collect on ${formatDate(p.maturityDate)}`}</span>
              </span>
              <span className="ui-row-value">{hideBalance ? '₦ ••••' : formatNaira(p.balance)}</span>
              <span className="ui-option-check" aria-hidden="true">{i === activePlanIdx && <Icons.check size={20} />}</span>
            </button>
          ))}
          {!pending && (
            <button type="button" className="ui-option" onClick={() => router.push('/customer/save?new=1')}>
              <span className="ui-row-icon" aria-hidden="true"><Icons.add size={20} /></span>
              <span className="ui-row-main"><span className="ui-row-title">Start a new plan</span></span>
            </button>
          )}
        </div>
      </BottomSheet>

      <BottomNav items={CUSTOMER_NAV} />
    </div>
  )
}
