'use client'
import { useCallback, useEffect, useState } from 'react'
import { Icons } from '@/components/ui/icons'
import { formatDate, formatNaira } from '@/lib/format'
import { describeFailure, postJson } from '@/lib/http'

/** The plan fields this card needs. Only Active online (source 'self') plans can auto-fund. */
export type AutoFundingPlan = { id: string; source?: string; status: string; cadence?: string; dailyAmount?: number }

type Mandate =
  | { status: 'none' }
  | { status: 'active' | 'paused' | 'cancelled'; amountPerCycle: number; nextPaymentAt: string | null; last4: string | null; bankName: string | null }

export function canAutoFund(plan: AutoFundingPlan) {
  return plan.status === 'Active' && plan.source === 'self'
}

// Daily plans are debited daily; weekly and monthly plans on their own cadence.
function perCycle(cadence?: string) {
  return cadence === 'daily' ? 'a day' : cadence === 'monthly' ? 'a month' : 'a week'
}
function everyCycle(cadence?: string) {
  return cadence === 'daily' ? 'every day' : cadence === 'monthly' ? 'every month' : 'every week'
}

function cardText(m: Mandate) {
  if (m.status === 'none' || !m.last4) return null
  return `•••• ${m.last4}${m.bankName ? ` · ${m.bankName}` : ''}`
}

/** Opt-in and manage auto-funding from a saved card. Renders nothing for cash (agent) plans. */
export default function AutoFunding({ plan, hideAmounts }: { plan: AutoFundingPlan; hideAmounts: boolean }) {
  const eligible = canAutoFund(plan)
  const [mandate, setMandate] = useState<Mandate | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<'' | 'start' | 'cancel'>('')
  const [confirmOff, setConfirmOff] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoadFailed(false)
    try {
      const res = await fetch(`/api/customer/auto-debit?planId=${encodeURIComponent(plan.id)}`)
      if (!res.ok) throw new Error()
      setMandate(await res.json() as Mandate)
    } catch {
      setLoadFailed(true)
    }
  }, [plan.id])

  useEffect(() => {
    if (!eligible) return
    setMandate(null); setError(''); setConfirmOff(false)
    load()
  }, [eligible, load])

  // A WebView restoring this page from bfcache (e.g. the user hits Back from Paystack) would otherwise
  // leave the button stuck on "Opening payment page…". Clear the busy state whenever the page is shown again.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setBusy('') }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  if (!eligible) return null

  async function start() {
    setError(''); setBusy('start')
    const r = await postJson<{ authorizationUrl?: string }>('/api/customer/auto-debit/init', { planId: plan.id })
    if (r.ok && r.data.authorizationUrl) {
      // Paystack returns to /customer/save/callback, which finishes the set-up. Keep the spinner until we leave.
      window.location.href = r.data.authorizationUrl
      return
    }
    setBusy('')
    if (!r.ok && r.status === 409) { load(); return }
    setError(r.ok ? 'We couldn’t reach the payment service. Please try again.' : describeFailure(r))
  }

  async function cancel() {
    setError(''); setBusy('cancel')
    const r = await postJson<{ status?: string }>('/api/customer/auto-debit/cancel', { planId: plan.id })
    setBusy('')
    if (!r.ok) { setError(describeFailure(r)); return }
    setConfirmOff(false)
    // Reflect "off" immediately so a slow reload doesn't leave it reading "On"; load() then confirms.
    setMandate(m => m && m.status === 'active' ? { ...m, status: 'cancelled' } : m)
    load()
  }

  const amount = (n: number) => hideAmounts ? '₦ ••••' : formatNaira(n, { minor: false })
  const startLabel = busy === 'start'
    ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Opening payment page…</>
    : null

  let body
  if (loadFailed) {
    body = (
      <div className="ui-autofund-body">
        <p className="ui-row-sub">We couldn’t check auto-funding just now.</p>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={load}>
          <Icons.retry size={18} aria-hidden="true" /> Try again
        </button>
      </div>
    )
  } else if (!mandate) {
    body = (
      <div className="ui-autofund-body" aria-busy="true">
        <p className="ui-row-sub"><span className="ui-spinner ui-spinner--sm ag-spin-dark" aria-hidden="true" /> Checking auto-funding…</p>
      </div>
    )
  } else if (mandate.status === 'active') {
    const card = cardText(mandate)
    body = (
      <>
        <dl className="ui-summary">
          <div className="ui-row">
            <dt className="ui-row-main ui-row-sub ui-summary-key">Status</dt>
            <dd className="ui-row-value"><span className="ui-status ui-status--sm ui-status--success">On</span></dd>
          </div>
          <div className="ui-row">
            <dt className="ui-row-main ui-row-sub ui-summary-key">We save</dt>
            <dd className="ui-row-value">{amount(mandate.amountPerCycle)} {perCycle(plan.cadence)}</dd>
          </div>
          <div className="ui-row">
            <dt className="ui-row-main ui-row-sub ui-summary-key">Next payment</dt>
            <dd className="ui-row-value">{mandate.nextPaymentAt ? formatDate(mandate.nextPaymentAt) : 'Nothing left to charge'}</dd>
          </div>
          {card && (
            <div className="ui-row">
              <dt className="ui-row-main ui-row-sub ui-summary-key">Card</dt>
              <dd className="ui-row-value ui-value-stack ui-autofund-card">
                <span>•••• {mandate.last4}</span>
                {mandate.bankName && <span className="ui-row-sub">{mandate.bankName}</span>}
              </dd>
            </div>
          )}
        </dl>
        <p className="ui-nudge">
          <Icons.card size={16} aria-hidden="true" />
          <span>The card fee is added on top, so the full amount is saved. It stops when this plan ends.</span>
        </p>
        <div className="ui-autofund-body">
          {confirmOff ? (
            <div className="ui-autofund-confirm" role="group" aria-label="Turn off auto-funding">
              <p className="ui-row-title">Turn off auto-funding?</p>
              <p className="ui-row-sub">We’ll stop taking money from your card. What you’ve saved stays in this plan.</p>
              <button type="button" className="ui-btn ui-btn--danger ui-btn--block" disabled={busy === 'cancel'} onClick={cancel}>
                {busy === 'cancel' ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Turning off…</> : 'Turn off'}
              </button>
              <button type="button" className="ui-btn ui-btn--plain ui-btn--block" disabled={busy === 'cancel'} onClick={() => { setConfirmOff(false); setError('') }}>Keep it on</button>
            </div>
          ) : (
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => { setConfirmOff(true); setError('') }}>Turn off auto-funding</button>
          )}
        </div>
      </>
    )
  } else if (mandate.status === 'paused') {
    const card = cardText(mandate)
    body = (
      <div className="ui-autofund-body">
        <p className="ui-banner ui-banner--warn">
          <Icons.pending size={18} aria-hidden="true" />
          <span>Auto-funding is paused. Payments from your card{card ? ` (${card})` : ''} didn’t go through a few times, so we stopped trying. Your plan is still running.</span>
        </p>
        <p className="ui-row-sub">Set it up again with the same card or a different one.</p>
        <p className="ui-card-note">Setting up again takes a ₦50 first payment to re-link your card. It’s added to this plan, and The card fee is added on top of each payment.</p>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={busy === 'start'} onClick={start}>
          {startLabel ?? 'Set up auto-funding again'}
        </button>
      </div>
    )
  } else {
    const cycleAmt = plan.dailyAmount != null ? amount(plan.dailyAmount) : null
    body = (
      <div className="ui-autofund-body">
        <p className="ui-row-sub">
          {mandate.status === 'cancelled' ? 'Auto-funding is off. ' : ''}
          We’ll save {cycleAmt ? <strong>{cycleAmt}</strong> : 'your plan amount'} {everyCycle(plan.cadence)} from your card — no transfer needed. The card fee is added on top, so the full amount is saved. It stops when this plan ends, and you can turn it off anytime.
        </p>
        <p className="ui-card-note">To link your card, we take a ₦50 first payment now. It’s added to this plan.</p>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={busy === 'start'} onClick={start}>
          {startLabel ?? (mandate.status === 'cancelled' ? 'Turn auto-funding back on' : 'Turn on auto-funding')}
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="ui-section-head"><h2>Auto-funding</h2></div>
      <section className="ui-card ui-card--list ui-autofund" aria-label="Auto-funding">
        {body}
        {error && <p className="ui-field-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}
      </section>
    </>
  )
}
