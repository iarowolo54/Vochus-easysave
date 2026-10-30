'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import BottomNav from '@/components/BottomNav'
import { CUSTOMER_NAV } from '@/components/nav-items'
import CollectionTracker from '@/components/customer/CollectionTracker'
import PlanEnded, { PlanSummary } from '@/components/customer/PlanEnded'
import DepositReceipt, { depositIcon, depositMethod } from '@/components/customer/DepositReceipt'
import { DayDetails, SavingsCalendar, WeekStrip, type DaySelection } from '@/components/customer/SavingsCard'
import TodayStatus from '@/components/customer/TodayStatus'
import { useCustomerMe } from '@/components/customer/useCustomerMe'
import ActionButton from '@/components/ui/ActionButton'
import BottomSheet from '@/components/ui/BottomSheet'
import Toast from '@/components/ui/Toast'
import { HomeSkeleton } from '@/components/ui/Skeleton'
import { takeJustPaid } from '@/lib/payment-flash'
import Amount, { useCountUp } from '@/components/ui/Amount'
import EmptyState from '@/components/ui/EmptyState'
import ListRow from '@/components/ui/ListRow'
import { Icons } from '@/components/ui/icons'
import { displayName, formatDate, formatNaira } from '@/lib/format'
import { getHideBalance, setHideBalance } from '@/lib/preferences'
import { buildSlots, dateKey, hasEnded, isWeekly } from '@/lib/savings-card'

type Plan = {
  id: string; dailyAmount: number; periodDays: number; cadence?: string; goal: string
  startDate: string; maturityDate: string; balance: number; status: string; interest?: number
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
  const [cardOpen, setCardOpen] = useState(false)
  const [daySel, setDaySel] = useState<DaySelection | null>(null)
  const [receiptTx, setReceiptTx] = useState<Tx | null>(null)
  const [toast, setToast] = useState('')

  // Arriving from a successful Paystack payment: confirm it here, where the new balance is.
  useEffect(() => {
    const amount = takeJustPaid()
    if (amount) setToast(`${formatNaira(amount)} added to your savings`)
  }, [])

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
  // The goal bar fills with the same counter as the balance, so they land together.
  const shownBalance = useCountUp(plan?.balance ?? 0, !hideBalance)

  function toggleBalance() {
    setHide(h => { setHideBalance(!h); return !h })
  }

  function choosePlan(i: number) {
    setActivePlanIdx(i)
    setPickerOpen(false)
  }

  if (loading) return <HomeSkeleton />

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

  const weekly = plan ? isWeekly(plan) : false
  const ended = plan ? hasEnded(plan) : false
  const pending = plan ? data.pendingRedemptions.find(r => r.savingsPlanId === plan.id) ?? null : null
  // Past its payout date with no collection in progress: show the result, not the saving controls.
  const finished = ended && !pending
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

  const goalPct = plan && target > 0 ? Math.min(100, (plan.balance / target) * 100) : 0
  const shownPct = plan && target > 0 ? Math.min(100, (shownBalance / target) * 100) : 0

  const planSwitch = plans.length > 1 ? (
    <button
      type="button"
      className="ui-plan-picker"
      onClick={() => setPickerOpen(true)}
      aria-haspopup="dialog"
      aria-label={`${plan?.goal ?? 'Plan'}. Change plan`}
    >
      <span className="ui-plan-picker-label">{plan?.goal}</span>
      <Icons.expand size={18} aria-hidden="true" />
    </button>
  ) : (
    <span className="ui-plan-name">{plan ? plan.goal : 'Savings balance'}</span>
  )
  const eyeButton = (
    <button
      type="button"
      className="ui-icon-btn ui-icon-btn--plain ui-hero-eye"
      onClick={toggleBalance}
      aria-label={hideBalance ? 'Show balance' : 'Hide balance'}
      aria-pressed={hideBalance}
    >
      {hideBalance ? <Icons.show size={18} aria-hidden="true" /> : <Icons.hide size={18} aria-hidden="true" />}
    </button>
  )

  return (
    <div className="ui-screen">
      <header className="ui-topbar">
        {data.photoUrl
          ? <img src={data.photoUrl} className="ui-avatar" alt="" />
          : <span className="ui-avatar" aria-hidden="true">{data.name[0]}</span>}
        <div className="ui-topbar-main">
          <div className="ui-topbar-sub ui-topbar-sub--above">{greeting}</div>
          <div className="ui-topbar-title">{firstName}</div>
        </div>
        <button
          type="button"
          className="ui-icon-btn"
          onClick={() => router.push('/customer/chat')}
          aria-label={`Message your agent, ${displayName(data.agent.name)}`}
        >
          <Icons.chat size={20} aria-hidden="true" />
        </button>
      </header>

      <main className="ui-container">
        {plan && finished ? (
          <section className="ui-hero" aria-label="Savings balance">
            {/* The pill is centred on its own; the eye hangs off its right edge so it doesn't shift the pill. */}
            <div className="ui-hero-top">
              <div className="ui-hero-top-inner">
                {planSwitch}
                {eyeButton}
              </div>
            </div>
            <PlanEnded
              plan={plan}
              hideAmounts={hideBalance}
              onCollect={() => router.push('/customer/redeem')}
              onNewPlan={() => router.push('/customer/save?new=1')}
            />
          </section>
        ) : (
          <section className="ui-card ui-balance" aria-label="Savings balance">
            <div className="ui-balance-head">
              {planSwitch}
              {eyeButton}
            </div>
            <p className="ui-balance-label">Saved so far</p>
            {hideBalance
              ? <span className="ui-amount ui-amount--hero" aria-label="Balance hidden">₦ ••••</span>
              : <Amount value={plan?.balance ?? 0} size="hero" animate />}

            {!plan && <p className="ui-balance-note">No active plan yet. Start one to begin saving.</p>}
            {plan && ended && <p className="ui-balance-note">Plan ended {formatDate(plan.maturityDate)}</p>}
            {plan && !ended && (
              <>
                {!hideBalance && target > 0 && (
                  <>
                    <div
                      className="ui-progress ui-balance-bar"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(goalPct)}
                      aria-label={`${formatNaira(plan.balance)} of ${formatNaira(target)} goal`}
                    >
                      <span style={{ width: `${shownPct}%` }} />
                    </div>
                    <p className="ui-balance-goal" aria-hidden="true">
                      <span>of {formatNaira(target, { minor: false })} goal</span>
                      <span>{Math.floor(shownPct)}%</span>
                    </p>
                  </>
                )}
                <dl className="ui-balance-facts">
                  <div>
                    <dt>{weekly ? 'You save weekly' : 'You save daily'}</dt>
                    <dd>{formatNaira(weekly ? plan.dailyAmount * 7 : plan.dailyAmount, { minor: false })}</dd>
                  </div>
                  <div>
                    <dt>You collect on</dt>
                    <dd>{formatDate(plan.maturityDate)}</dd>
                    <dd className="ui-balance-fact-sub">
                      {daysUntil(plan.maturityDate) === 0 ? 'Today' : daysUntil(plan.maturityDate) === 1 ? 'Tomorrow' : `In ${daysUntil(plan.maturityDate)} days`}
                    </dd>
                  </div>
                  <div className="ui-balance-fact-wide">
                    <dt>Interest so far</dt>
                    <dd>{hideBalance ? '₦ ••••' : formatNaira(plan.interest ?? 0)}</dd>
                  </div>
                </dl>
              </>
            )}
            {plan && !ended && !pending && <TodayStatus weekly={weekly} deposits={recentForStatus} />}
          </section>
        )}

        {pending && <CollectionTracker status={pending.status} onView={() => router.push('/customer/redeem')} />}

        {!finished && <div className="ui-actions">
          {!ended && (
            <ActionButton
              icon={pending ? 'locked' : 'add'}
              label={pending ? 'Locked' : 'Save'}
              disabled={!!pending}
              onClick={() => router.push(plan ? `/customer/save?planId=${plan.id}` : '/customer/save')}
            />
          )}
          <ActionButton icon="withdraw" label="Collect" onClick={() => router.push('/customer/redeem')} />
          <ActionButton
            icon="plan"
            label="New plan"
            disabled={!!pending}
            onClick={() => router.push('/customer/save?new=1')}
          />
        </div>}

        {plan && finished && <PlanSummary plan={plan} hideAmounts={hideBalance} />}
        {plan && !finished && (
          <WeekStrip plan={plan} deposits={planTxs} onOpenCard={() => setCardOpen(true)} onSelect={setDaySel} />
        )}
        {plan && finished && (
          <button type="button" className="ui-card ui-card-link" onClick={() => setCardOpen(true)}>
            <span className="ui-row-main">
              <span className="ui-row-title">Savings card</span>
              <span className="ui-row-sub">
                You saved on {buildSlots(plan, depositDates).filter(x => x.state === 'saved').length} of{' '}
                {weekly ? Math.ceil(plan.periodDays / 7) : plan.periodDays} {weekly ? 'weeks' : 'days'}
              </span>
            </span>
            <Icons.next size={20} aria-hidden="true" />
          </button>
        )}

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
                icon={depositIcon(tx)}
                title="Savings deposit"
                sub={`${formatDate(tx.createdAt)} · ${depositMethod(tx)}`}
                value={hideBalance ? '₦ ••••' : <Amount value={tx.amount} incoming />}
                onClick={() => setReceiptTx(tx)}
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
          <p className="ui-safety">
            <Icons.locked size={16} aria-hidden="true" />
            <span>Only give cash to {displayName(data.agent.name).split(' ')[0]}, and check it shows here the same day.</span>
          </p>
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
              <span className="ui-row-main">
                <span className="ui-row-title" style={{ display: 'block' }}>{p.goal}</span>
                <span className="ui-row-sub" style={{ display: 'block' }}>{hasEnded(p)
                    ? (p.balance >= p.dailyAmount * p.periodDays ? 'Goal reached' : `Ended ${formatDate(p.maturityDate)}`)
                    : `Collect on ${formatDate(p.maturityDate)}`}</span>
              </span>
              <span className="ui-row-value">{hideBalance ? '₦ ••••' : formatNaira(p.balance)}</span>
              <span className="ui-option-check" aria-hidden="true">{i === activePlanIdx && <Icons.check size={20} />}</span>
            </button>
          ))}
          {!pending && (
            <button type="button" className="ui-option" onClick={() => router.push('/customer/save?new=1')}>
              <span className="ui-row-icon ui-row-icon--action" aria-hidden="true"><Icons.add size={20} /></span>
              <span className="ui-row-main"><span className="ui-row-title">Start a new plan</span></span>
            </button>
          )}
        </div>
      </BottomSheet>

      <BottomSheet open={cardOpen} onClose={() => setCardOpen(false)} title={plan ? `Savings card · ${plan.goal}` : 'Savings card'}>
        {plan && <SavingsCalendar plan={plan} deposits={planTxs} hideAmounts={hideBalance} onSelect={setDaySel} />}
      </BottomSheet>
      <BottomSheet open={!!daySel} onClose={() => setDaySel(null)} title={daySel?.title ?? ''}>
        {daySel && <DayDetails selection={daySel} hideAmounts={hideBalance} onOpen={d => setReceiptTx(planTxs.find(t => t.id === d.id) ?? null)} />}
      </BottomSheet>
      <BottomSheet open={!!receiptTx} onClose={() => setReceiptTx(null)} title="Deposit receipt">
        {receiptTx && (
          <DepositReceipt
            tx={receiptTx}
            planName={plans.find(p => p.id === receiptTx.planId)?.goal ?? 'Savings'}
            hideAmounts={hideBalance}
            onHelp={() => router.push(`/customer/chat?ref=${encodeURIComponent(receiptTx.ref)}`)}
          />
        )}
      </BottomSheet>

      {toast && <Toast message={toast} onDone={() => setToast('')} />}

      <BottomNav items={CUSTOMER_NAV} />
    </div>
  )
}
