'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import CustomerBottomNav from '@/components/customer/CustomerBottomNav'
import CollectionTracker from '@/components/customer/CollectionTracker'
import PlanEnded, { PlanSummary } from '@/components/customer/PlanEnded'
import DepositReceipt, { depositIcon, depositMethod } from '@/components/customer/DepositReceipt'
import { DayDetails, SavingsCalendar, WeekStrip, type DaySelection } from '@/components/customer/SavingsCard'
import TodayStatus from '@/components/customer/TodayStatus'
import { useCustomerMe } from '@/components/customer/useCustomerMe'
import ActionButton from '@/components/ui/ActionButton'
import BottomSheet from '@/components/ui/BottomSheet'
import ReopenCodeSheet from '@/components/ui/ReopenCodeSheet'
import EmailAlertsSheet from '@/components/customer/EmailAlertsSheet'
import Toast from '@/components/ui/Toast'
import { biometricDeclined, biometricState, enableBiometric, setBiometricDeclined } from '@/lib/app-biometric'
import { HomeSkeleton } from '@/components/ui/Skeleton'
import { takeJustPaid } from '@/lib/payment-flash'
import Amount, { useCountUp } from '@/components/ui/Amount'
import EmptyState from '@/components/ui/EmptyState'
import ListRow from '@/components/ui/ListRow'
import { Icons } from '@/components/ui/icons'
import InterestNudge, { InterestCard, InterestChip, earnsInterest } from '@/components/customer/InterestNudge'
import AutoFunding from '@/components/customer/AutoFunding'
import { isFlexible } from '@/lib/flexible-savings'
import { PAYSTACK_ENABLED } from '@/lib/paystack-off'
import { displayName, formatDate, formatNaira } from '@/lib/format'
import { getHideBalance, setHideBalance } from '@/lib/preferences'
import { BULK_SAVINGS_LABEL, isEligiblePlan, selectableKeys } from '@/lib/catchup'
import NotificationBell from '@/components/ui/NotificationBell'
import { useFundingMode } from '@/lib/use-funding-mode'
import { buildSlots, currentSlot, dateKey, dayDeposits, hasEnded, isWeekly } from '@/lib/savings-card'

type Plan = {
  id: string; dailyAmount: number; periodDays: number; cadence?: string; goal: string
  startDate: string; maturityDate: string; balance: number; status: string; interest?: number
  source?: string; coveredKeys?: string[]; coveredRefs?: string[]; nextInterestAmount?: number; daysToNextInterest?: number | null
}
type Tx = {
  id: string; amount: number; ref: string; createdAt: string; method: string | null
  planId: string | null; recordedBy: string
}
type CustomerData = {
  customerId: string; name: string; phone: string; email: string | null; emailVerified?: boolean; photoUrl: string | null
  agent: { name: string; agentId: string; phone: string }
  plan: Plan | null
  plans: Plan[]
  redeemedPlans?: { id: string; goal: string; dailyAmount: number; periodDays: number; cadence?: string }[]
  transactions: Tx[]
  pendingRedemptions: { ref: string; status: string; savingsPlanId: string }[]
}

function capitalise(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

function daysUntil(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))
}

function daysLeftText(iso: string) {
  const d = daysUntil(iso)
  return d === 0 ? 'Ends today' : `${d} day${d === 1 ? '' : 's'} left`
}

/** Plain facts about a running plan, as a list under the actions. */
function PlanDetails({ plan }: { plan: Plan }) {
  const weekly = isWeekly(plan)
  return (
    <>
      <div className="ui-section-head"><h2>Plan details</h2></div>
      <dl className="ui-card ui-card--list ui-summary">
        <div className="ui-row">
          <dt className="ui-row-main ui-row-sub ui-summary-key">You save</dt>
          <dd className="ui-row-value">{isFlexible(plan.cadence) ? 'Any amount, any day' : `${formatNaira(weekly ? plan.dailyAmount * 7 : plan.dailyAmount, { minor: false })} ${weekly ? 'a week' : 'a day'}`}</dd>
        </div>
        <div className="ui-row">
          <dt className="ui-row-main ui-row-sub ui-summary-key">You collect on</dt>
          <dd className="ui-row-value ui-value-stack">
            <span>{formatDate(plan.maturityDate)}</span>
          </dd>
        </div>
        <div className="ui-row">
          <dt className="ui-row-main ui-row-sub ui-summary-key">Started</dt>
          <dd className="ui-row-value">{formatDate(plan.startDate)}</dd>
        </div>
      </dl>
    </>
  )
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
  // Asked once per sign-in: "Not now" lasts until the browser session ends, so it comes back next time they sign in.
  const [emailAsk, setEmailAsk] = useState(false)
  const [emailSheet, setEmailSheet] = useState(false)
  useEffect(() => { try { setEmailAsk(sessionStorage.getItem('ves.emailAlertsAsk') !== 'no') } catch { setEmailAsk(true) } }, [])
  function dismissEmailAsk() { setEmailAsk(false); try { sessionStorage.setItem('ves.emailAlertsAsk', 'no') } catch {} }
  const [bioOffer, setBioOffer] = useState(false)
  const [reopenFor, setReopenFor] = useState<{ id: string; name: string } | null>(null)

  // A finished plan goes back to Active only after the customer types the code texted to them; then the normal save screen takes over.
  function saveAgain(planId: string, name: string) { setReopenFor({ id: planId, name }) }

  async function acceptBiometric() {
    setBioOffer(false)
    if (!await enableBiometric()) setToast('Couldn’t turn on fingerprint sign-in. Try again in Settings.')
  }

  function declineBiometric() {
    setBiometricDeclined(true)
    setBioOffer(false)
  }

  // Arriving from a successful Paystack payment: confirm it here, where the new balance is.
  useEffect(() => {
    const amount = takeJustPaid()
    if (amount) setToast(`${formatNaira(amount)} added to your savings`)
  }, [])

  useEffect(() => { setHide(getHideBalance()) }, [])

  // Offer fingerprint sign-in once, on this phone; Settings can change it later.
  useEffect(() => {
    if (!data) return
    const check = () => {
      const bio = biometricState()
      setBioOffer(bio.canEnrol && !bio.enrolled && !biometricDeclined())
    }
    check()
    window.addEventListener('vochus:flags-ready', check)
    return () => window.removeEventListener('vochus:flags-ready', check)
  }, [data])

  const plans = data ? data.plans ?? (data.plan ? [data.plan] : []) : []
  const plan = plans[activePlanIdx] ?? null
  const planTxs = useMemo(
    () => (data && plan ? data.transactions.filter(t => t.planId === plan.id) : []),
    [data, plan],
  )
  // Bulk Savings deposits count for the days they cover, not the day they were paid.
  const dayTxs = useMemo(() => dayDeposits(planTxs, plan?.coveredRefs), [planTxs, plan?.coveredRefs])
  const depositDates = useMemo(() => dayTxs.map(t => t.createdAt), [dayTxs])
  // The goal bar fills with the same counter as the balance, so they land together.
  const shownBalance = useCountUp(plan?.balance ?? 0, !hideBalance)

  function toggleBalance() {
    setHide(h => { setHideBalance(!h); return !h })
  }

  function choosePlan(i: number) {
    setActivePlanIdx(i)
    setPickerOpen(false)
  }

  /** Automatic saving charges a card, so it is offered only while customers are on card. */
  const byCard = useFundingMode().customer === 'card'

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
  /** Flexible plans have no set days, so no day calendar, no "saved today" and no auto-funding. */
  const flex = !!plan && isFlexible(plan.cadence)
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
  // Bulk Savings is offered only for eligible (active, self-service, daily/weekly) plans with a day left to pay for.
  const slots = plan ? buildSlots(plan, depositDates, plan.coveredKeys ?? []) : []
  const canBulkSave = !!plan && !ended && !pending
    && isEligiblePlan({ status: plan.status, source: plan.source ?? '', cadence: plan.cadence })
    && selectableKeys(slots).length > 0
  const recentForStatus = dayTxs.filter(t => {
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
        <NotificationBell countUrl="/api/customer/notifications?count=1" href="/customer/notifications" />
      </header>

      <main className="ui-container">
        {data.email && !data.emailVerified && emailAsk && (
          <section className="ui-banner ui-banner--info" aria-label="Email alerts" style={{ flexDirection: 'column' }}>
            <div><strong>Want alerts by email?</strong> Confirm your email and we’ll tell you when someone signs in and when a payment reaches your savings. You can turn it off any time in Settings.</div>
            <div className="ui-btn-row">
              <button type="button" className="ui-btn ui-btn--primary" onClick={() => setEmailSheet(true)}>Confirm my email</button>
              <button type="button" className="ui-btn ui-btn--secondary" onClick={dismissEmailAsk}>Not now</button>
            </div>
          </section>
        )}
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
              note={<InterestNudge plan={plan} hideAmounts={hideBalance} />}
            />
          </section>
        ) : (
          <section className="ui-card ui-balance" aria-label="Savings balance">
            <div className="ui-balance-head">
              {planSwitch}
              {eyeButton}
            </div>
            {hideBalance
              ? <span className="ui-amount ui-amount--hero" aria-label="Balance hidden">₦ ••••</span>
              : <Amount value={plan?.balance ?? 0} size="hero" animate />}
            {plan && !ended && <InterestChip plan={plan} hideAmounts={hideBalance} />}

            {!plan && <p className="ui-balance-note">No active plan yet. Start one to begin saving.</p>}
            {plan && ended && <p className="ui-balance-note">Plan ended {formatDate(plan.maturityDate)}</p>}
            {plan && ended && <InterestNudge plan={plan} hideAmounts={hideBalance} />}
            {plan && !ended && (
              <>
                {!hideBalance && target > 0 && (
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
                )}
                <p className="ui-balance-goal">
                  {!hideBalance && target > 0 && (
                    <span aria-hidden="true"><strong>{Math.floor(shownPct)}%</strong> of {formatNaira(target, { minor: false })}</span>
                  )}
                  <span>{daysLeftText(plan.maturityDate)}</span>
                </p>
              </>
            )}
            {plan && !ended && !pending && !flex && <TodayStatus weekly={weekly} deposits={recentForStatus} covered={currentSlot(slots, today, weekly)?.coveredOnly} paidAhead={slots.filter(s => s.key > today && s.coveredOnly).length} />}
          </section>
        )}

        {pending && <CollectionTracker status={pending.status} onView={() => router.push('/customer/redeem')} />}

        {plan && finished && (
          <div className="ui-actions">
            <ActionButton icon="add" label="Save again" onClick={() => saveAgain(plan.id, plan.goal)} />
          </div>
        )}

        {!finished && <div className="ui-actions">
          {!ended && (
            <ActionButton
              icon={pending ? 'locked' : 'add'}
              label={pending ? 'Locked' : 'Save'}
              disabled={!!pending}
              onClick={() => router.push(plan ? `/customer/save?planId=${plan.id}` : '/customer/save')}
            />
          )}
          {canBulkSave && plan && (
            <ActionButton icon="history" label={BULK_SAVINGS_LABEL} onClick={() => router.push(`/customer/catchup?planId=${encodeURIComponent(plan.id)}`)} />
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
        {/* Online savers see interest and plan details first; cash savers check their week first. */}
        {plan && !finished && (earnsInterest(plan) ? (
          <>
            <InterestCard plan={plan} hideAmounts={hideBalance} />
            <PlanDetails plan={plan} />
            {PAYSTACK_ENABLED && byCard && !ended && !flex && <AutoFunding plan={plan} hideAmounts={hideBalance} />}
            {!flex && <WeekStrip plan={plan} deposits={planTxs} paused={!!pending} onOpenCard={() => setCardOpen(true)} onSelect={setDaySel} />}
          </>
        ) : (
          <>
            {!flex && <WeekStrip plan={plan} deposits={planTxs} paused={!!pending} onOpenCard={() => setCardOpen(true)} onSelect={setDaySel} />}
            <PlanDetails plan={plan} />
          </>
        ))}
        {plan && finished && !flex && (
          <button type="button" className="ui-card ui-card-link" onClick={() => setCardOpen(true)}>
            <span className="ui-row-main">
              <span className="ui-row-title">Savings card</span>
              <span className="ui-row-sub">
                You saved on {slots.filter(x => x.state === 'saved').length} of{' '}
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

        {!!data.redeemedPlans?.length && (
          <>
            <div className="ui-section-head">
              <h2>Collected plans</h2>
            </div>
            <section className="ui-card ui-card--list">
              {data.redeemedPlans.map(p => (
                <ListRow
                  key={p.id}
                  icon="plan"
                  title={p.goal}
                  sub={`${isFlexible(p.cadence) ? 'Flexible' : `${formatNaira(p.dailyAmount)} a ${p.cadence === 'weekly' ? 'week' : p.cadence === 'monthly' ? 'month' : 'day'}`} · collected`}
                  value="Save again"
                  onClick={() => saveAgain(p.id, p.goal)}
                />
              ))}
            </section>
          </>
        )}

        <div className="ui-section-head">
          <h2>Your agent</h2>
        </div>
        <section className="ui-card ui-card--list">
          <ListRow
            leading={<span className="ui-avatar" aria-hidden="true">{data.agent.name[0]}</span>}
            title={displayName(data.agent.name)}
            sub={plan && !earnsInterest(plan) ? 'Your agent · collects your savings' : `Agent ID ${data.agent.agentId}`}
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
                    ? (!isFlexible(p.cadence) && p.balance >= p.dailyAmount * p.periodDays ? 'Goal reached' : `Ended ${formatDate(p.maturityDate)}`)
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

      <BottomSheet open={bioOffer} onClose={declineBiometric} title="Sign in with your fingerprint?">
        <p className="ui-row-sub">Use your fingerprint instead of your password on this phone. You can change this in Settings.</p>
        <div className="ui-btn-row">
          <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={acceptBiometric}>Turn on</button>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={declineBiometric}>Not now</button>
        </div>
      </BottomSheet>

      {reopenFor && (
        <ReopenCodeSheet
          open
          onClose={() => setReopenFor(null)}
          who={{ kind: 'customer' }}
          planName={reopenFor.name}
          sendUrl="/api/customer/plan/reopen/code"
          confirmUrl="/api/customer/plan/reopen"
          body={{ planId: reopenFor.id }}
          onDone={() => router.push(`/customer/save?planId=${encodeURIComponent(reopenFor.id)}`)}
        />
      )}
      {data.email && <EmailAlertsSheet open={emailSheet} onClose={() => setEmailSheet(false)} email={data.email} onConfirmed={() => { setEmailSheet(false); setToast('Email alerts are on.'); reload() }} />}
      {toast && <Toast message={toast} onDone={() => setToast('')} />}

      <CustomerBottomNav />
    </div>
  )
}
