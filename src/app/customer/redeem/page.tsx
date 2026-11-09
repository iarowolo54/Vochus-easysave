'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import CustomerBottomNav from '@/components/customer/CustomerBottomNav'
import BankSelect from '@/components/ui/BankSelect'
import { NIGERIAN_BANKS } from '@/lib/banks'
import { cleanAccountName } from '@/lib/payout-account'
import CodeBoxes from '@/components/ui/CodeBoxes'
import EmptyState from '@/components/ui/EmptyState'
import { FormError } from '@/components/ui/FormErrors'
import ListRow from '@/components/ui/ListRow'
import { HomeSkeleton } from '@/components/ui/Skeleton'
import { Icons } from '@/components/ui/icons'
import { formatDate, formatNaira } from '@/lib/format'
import { DEFAULT_FLEXIBLE_SETTINGS, flexibleDeduction, isFlexible } from '@/lib/flexible-savings'
import { useFlexibleTerms } from '@/lib/use-flexible-terms'
import { IN_FLIGHT_REDEMPTION_STATUSES } from '@/lib/redemption-statuses'

type Redemption = {
  id: string; ref: string; status: string; balance: number; penalty: number
  netPayout: number; requestedAt: string; token?: string; tokenExpiry?: string
  reason: string; type: string; expired?: boolean
}
type Plan = { onlineFee?: number; onlineFeePct?: number; ajoFee?: number; ajoFeePct?: number; source?: string; balance: number; interest?: number; dailyAmount: number; cadence?: string; maturityDate: string; hasCashDeposit?: boolean; goal?: string }
type Result = { balance?: number; netPayout?: number }

const REASONS = ['Plan matured', 'Medical emergency', 'School fees', 'Business need', 'Personal emergency', 'Other']

// Where a request is, in order. The customer confirms their code, then the agent and Vochus approve.
const STEPS = ['Request sent', 'Code confirmed', 'Agent approval', 'Final approval and payment']
// AwaitingOTP and Finalizing are the payout being sent, so the last step is still the current one.
const CURRENT_STEP: Record<string, number> = { Pending: 1, TokenValidated: 2, AgentApproved: 3, AwaitingOTP: 3, Finalizing: 3, Approved: 4 }
// "In progress" for the customer excludes Approved: that payout is already done (the final step in
// CURRENT_STEP), so it must not hijack the hero CTA or make a paid row re-openable.
const OPEN_REDEMPTION_STATUSES = IN_FLIGHT_REDEMPTION_STATUSES.filter(s => s !== 'Approved')

function statusTone(s: string): 'success' | 'danger' | 'warn' {
  return s === 'Approved' ? 'success' : s === 'Rejected' ? 'danger' : 'warn'
}
function statusLabel(s: string) {
  if (s === 'Pending') return 'Needs your code'
  if (s === 'TokenValidated') return 'With your agent'
  if (s === 'AgentApproved') return 'Final approval'
  if (s === 'AwaitingOTP') return 'Processing payout'
  if (s === 'Finalizing') return 'Finalizing payout'
  if (s === 'Approved') return 'Paid'
  if (s === 'Rejected') return 'Declined'
  return s
}

/** Where the collection code was sent, said plainly. */
function codeWhere(sentBy: string[]): string {
  const email = sentBy.includes('email'), sms = sentBy.includes('sms')
  if (email && sms) return 'We sent your code by text message and email.'
  return email ? 'We sent your code to your email.' : 'We sent your code by text message.'
}

export default function CustomerRedeemPage() {
  const planIdRef = useRef<string | null>(null)
  const flexTerms = useFlexibleTerms()
  const router = useRouter()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [redemptions, setRedemptions] = useState<Redemption[]>([])
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<'idle' | 'form' | 'token' | 'done' | 'resume-token' | 'awaiting'>('idle')
  // Where the new code went ('email', 'sms'), so the customer knows where to look.
  const [sentBy, setSentBy] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [useBankTransfer, setUseBankTransfer] = useState(false)
  const [bankCode, setBankCode] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [bankName, setBankName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [token, setToken] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [currentRef, setCurrentRef] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [selectedRedemption, setSelectedRedemption] = useState<Redemption | null>(null)

  useEffect(() => {
    // Set when Collect came from a specific plan (an Ajo pot); otherwise the customer's newest plan.
    const wantedPlan = new URLSearchParams(window.location.search).get('planId')
    planIdRef.current = wantedPlan
    fetch('/api/customer/me')
      .then(r => { if (r.status === 401) { router.push('/customer/login'); return null } return r.json() })
      .then(d => { if (d) setPlan(wantedPlan ? d.plans?.find((p: { id: string }) => p.id === wantedPlan) ?? d.plan : d.plan) })
      .catch(() => {})

    fetch(`/api/customer/redeem${wantedPlan ? `?planId=${encodeURIComponent(wantedPlan)}` : ''}`)
      .then(r => r.json())
      .then(d => { if (d.redemptions) setRedemptions(d.redemptions) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [router])

  async function submitRequest() {
    setError('')
    if (!reason) { setError('Choose why you’re collecting.'); return }
    if (useBankTransfer && (!bankCode || accountNumber.length !== 10 || !cleanAccountName(accountName))) { setError('Choose your bank, enter your 10-digit account number and the account name, or choose cash from your agent.'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/customer/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          ...(planIdRef.current ? { planId: planIdRef.current } : {}),
          ...(useBankTransfer ? { accountNumber, accountName: accountName.trim(), bankCode } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Your request didn’t go through. Please try again.'); return }
      setToken(data.token)
      setCurrentRef(data.ref)
      setSentBy(Array.isArray(data.sentBy) ? data.sentBy : [])
      setResult(data)
      setTokenInput('')
      setStep('token')
    } catch { setError('No connection. Check your internet and try again.') }
    finally { setSubmitting(false) }
  }

  async function validateToken() {
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/customer/redeem', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: currentRef, token: tokenInput }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'That code didn’t work. Check it and try again.'); return }
      setStep('done')
      const updated = redemptions.map(r => r.ref === currentRef ? { ...r, status: 'TokenValidated' } : r)
      setRedemptions(updated)
    } catch { setError('No connection. Check your internet and try again.') }
    finally { setSubmitting(false) }
  }

  function openRedemption(r: Redemption) {
    setError('')
    setTokenInput('')
    setSelectedRedemption(r)
    if (r.status === 'Pending') {
      setCurrentRef(r.ref)
      setToken(r.token ?? '')
      setStep('resume-token')
    } else {
      setStep('awaiting')
    }
  }

  function back() {
    if (step !== 'idle') { setStep('idle'); setError(''); setTokenInput(''); setSelectedRedemption(null) }
    else router.push('/customer/dashboard')
  }

  if (loading) return <HomeSkeleton />

  const hasCash = !!plan?.hasCashDeposit
  // Flexible plans: commission (cash plans) and, before the end date, the penalty — the same rule the server applies.
  const flexDeduct = plan && isFlexible(plan.cadence)
    ? flexibleDeduction({ source: plan.source ?? 'self', balance: plan.balance, maturityDate: new Date(plan.maturityDate), at: new Date() }, { ...DEFAULT_FLEXIBLE_SETTINGS, ...flexTerms })
    : null
  const isEarly = flexDeduct ? flexDeduct.early : plan ? new Date() < new Date(plan.maturityDate) : false
  let savingsFee = 0
  if (flexDeduct) savingsFee = flexDeduct.deduction
  // An Ajo pot: the server's figure at the group's locked rate.
  else if (plan?.cadence === 'ajo') savingsFee = plan.ajoFee ?? 0
  // Online (self) plans pay no platform fee; the server waives it, so the preview must too.
  else if (plan && plan.source !== 'self') {
    if (hasCash && plan.cadence !== 'weekly') {
      savingsFee = Math.min(plan.dailyAmount, plan.balance)
    } else {
      const totalRate = plan.cadence === 'weekly'
        ? (hasCash ? 0.075 : 0.035)
        : 0.025
      savingsFee = Math.round(plan.balance * totalRate * 100) / 100
    }
  }
  // Online savers' Platform Fee: the server's figure. Comes on top of a flexible plan's early-stop penalty.
  const onlineFee = plan?.onlineFee ?? 0
  if (plan && onlineFee > 0) savingsFee = Math.min(plan.balance, Math.round((savingsFee + onlineFee) * 100) / 100)
  const interest = plan?.interest ?? 0
  const netPayout = plan ? Math.round((plan.balance - savingsFee + interest) * 100) / 100 : 0
  const inProgress = redemptions.find(r => OPEN_REDEMPTION_STATUSES.includes(r.status) && !r.expired) ?? null

  const title = step === 'form' ? 'Collect savings' : step === 'token' || step === 'resume-token' ? 'Confirm your request' : step === 'awaiting' ? 'Your request' : step === 'done' ? 'Request sent' : 'Collect'

  return (
    <div className="ui-screen">
      <header className="ui-topbar">
        <button type="button" className="ui-icon-btn" onClick={back} aria-label={step === 'idle' ? 'Back to home' : 'Back'}>
          <Icons.back size={22} aria-hidden="true" />
        </button>
        <div className="ui-topbar-main"><h1 className="ui-topbar-title">{title}</h1></div>
      </header>

      <main className="ui-container">
        {step === 'done' ? (
          <section className="ui-card ag-done">
            <span className="ag-sent-icon" aria-hidden="true"><Icons.check size={30} /></span>
            <h2 className="ag-q">Request sent</h2>
            <p className="ag-q-lead">Your agent will check it, then Vochus gives final approval and sends your money. We’ll let you know at each step.</p>
            {result && (
              <dl className="ag-breakdown ag-breakdown--flush">
                <div><dt>Saved</dt><dd>{formatNaira(result.balance ?? 0)}</dd></div>
                <div className="ag-breakdown-total"><dt>You’ll receive</dt><dd>{formatNaira(result.netPayout ?? 0)}</dd></div>
              </dl>
            )}
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => router.push('/customer/dashboard')}>Back to home</button>
          </section>

        ) : step === 'awaiting' && selectedRedemption ? (
          <>
            <section className="ui-card ag-status-card">
              <span className={`ui-status ui-status--${statusTone(selectedRedemption.status)}`}>{statusLabel(selectedRedemption.status)}</span>
              <p className="ag-status-amount">{formatNaira(selectedRedemption.netPayout ?? 0)}</p>
              <p className="ui-row-sub">Requested {formatDate(selectedRedemption.requestedAt)}</p>
              <ol className="ui-steps">
                {STEPS.map((label, i) => {
                  const current = CURRENT_STEP[selectedRedemption.status] ?? 1
                  const state = i < current ? 'done' : i === current ? 'current' : 'todo'
                  return (
                    <li key={label} className={`ui-step ui-step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                      <span className="ui-step-dot" aria-hidden="true">{state === 'done' && <Icons.check size={14} />}</span>
                      <span className="ui-step-label">{label}</span>
                    </li>
                  )
                })}
              </ol>
            </section>
            <dl className="ui-card ag-breakdown ag-breakdown--card">
              <div><dt>Reference</dt><dd className="ag-mono">{selectedRedemption.ref}</dd></div>
              <div><dt>Reason</dt><dd>{selectedRedemption.reason}</dd></div>
            </dl>
          </>

        ) : (step === 'token' || step === 'resume-token') ? (
          <section className="ui-card ag-confirm">
            <h2 className="ag-q">Enter your code to confirm</h2>
            <p className="ag-q-lead">
              {step === 'token' && sentBy.length > 0 && <>{codeWhere(sentBy)} </>}
              This confirms the request is really from you.
            </p>
            {token && (
              <div className="ag-code-show">
                <span className="ui-row-sub">Your code</span>
                <strong>{token}</strong>
              </div>
            )}
            <FormError message={error} />
            <CodeBoxes value={tokenInput} onChange={v => { setTokenInput(v); setError('') }} onComplete={validateToken} label="Confirmation code" error={!!error} autoFocus />
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block ag-confirm-btn" disabled={submitting || tokenInput.length !== 6} onClick={validateToken}>
              {submitting ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Checking…</> : 'Confirm request'}
            </button>
          </section>

        ) : step === 'form' && plan ? (
          <>
            <section className="ui-card">
              <h2 className="ag-q ag-q--amount"><span className="ag-q-kicker">You’ll receive</span>{formatNaira(netPayout)}</h2>
              {isEarly && <p className="ag-early"><Icons.pending size={16} aria-hidden="true" /> Your plan ends {formatDate(plan.maturityDate)}, so this is an early collection.</p>}
              <dl className="ag-breakdown">
                <div><dt>Saved</dt><dd>{formatNaira(plan.balance)}</dd></div>
                {flexDeduct ? <>
                  {flexDeduct.commission > 0 && <div><dt>Commission ({flexTerms.cashCommissionPct}%)</dt><dd className="ag-neg">−{formatNaira(flexDeduct.commission)}</dd></div>}
                  {flexDeduct.penalty > 0 && <div><dt>Stopping early ({flexTerms.penaltyPct}%)</dt><dd className="ag-neg">−{formatNaira(flexDeduct.penalty)}</dd></div>}
                {onlineFee > 0 && <div><dt>Platform Fee ({plan.onlineFeePct ?? 0}%)</dt><dd className="ag-neg">−{formatNaira(onlineFee)}</dd></div>}
                </> : savingsFee > 0 && <div><dt>{plan.cadence === 'ajo' ? `Platform Fee (${plan.ajoFeePct ?? 0}%)` : onlineFee > 0 ? `Platform Fee (${plan.onlineFeePct ?? 0}%)` : 'Platform fee'}</dt><dd className="ag-neg">−{formatNaira(savingsFee)}</dd></div>}
                <div><dt>Interest earned</dt><dd>+{formatNaira(interest)}</dd></div>
                <div className="ag-breakdown-total"><dt>You’ll receive</dt><dd>{formatNaira(netPayout)}</dd></div>
              </dl>

              <p className="ag-label">Why are you collecting?</p>
              <div className="ag-goal-chips" role="group" aria-label="Reason">
                {REASONS.map(r => (
                  <button key={r} type="button" className="ag-chip" aria-pressed={reason === r} onClick={() => { setReason(r); setError('') }}>{r}</button>
                ))}
              </div>

              <p className="ag-label">How do you want it?</p>
              <div className="ag-radio-group">
                {[
                  { bank: false, t: 'Cash from my agent', s: 'Your agent hands it to you', icon: 'cash' as const },
                  { bank: true, t: 'Bank transfer', s: 'Sent to your bank account', icon: 'loan' as const },
                ].map(o => {
                  const Icon = Icons[o.icon]
                  return (
                    <button key={o.t} type="button" role="radio" aria-checked={useBankTransfer === o.bank} className="ag-radio" onClick={() => { setUseBankTransfer(o.bank); setError('') }}>
                      <span className="ag-radio-icon" aria-hidden="true"><Icon size={20} /></span>
                      <span className="ag-payee-main">
                        <span className="ui-row-title ui-block">{o.t}</span>
                        <span className="ui-row-sub ui-block">{o.s}</span>
                      </span>
                      <span className="ui-radio" aria-hidden="true" />
                    </button>
                  )
                })}
              </div>

              {useBankTransfer && (
                <div className="ag-bank-fields">
                  <BankSelect banks={NIGERIAN_BANKS} placeholder="Choose your bank" value={bankCode ? { code: bankCode, name: bankName } : null}
                    onChange={b => { setBankCode(b.code); setBankName(b.name) }} />
                  <div className="ag-tf-wrap">
                    <div className={`ag-tf${!bankCode ? ' is-disabled' : ''}`}>
                      <label className="ag-tf-label" htmlFor="acct">Account number</label>
                      <input id="acct" className="ag-tf-input ag-tf-num" type="tel" inputMode="numeric" maxLength={10} placeholder="10 digits" disabled={!bankCode}
                        value={accountNumber} onChange={e => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))} />
                    </div>
                  </div>
                  <div className="ag-tf-wrap">
                    <div className={`ag-tf${!bankCode ? ' is-disabled' : ''}`}>
                      <label className="ag-tf-label" htmlFor="acct-name">Account name</label>
                      <input id="acct-name" className="ag-tf-input" autoComplete="off" autoCapitalize="characters" maxLength={80} placeholder="As it is on the account" disabled={!bankCode}
                        value={accountName} onChange={e => setAccountName(e.target.value)} />
                    </div>
                    <p className="ag-fineprint">Type it exactly as your bank shows it. We check it before we pay.</p>
                  </div>
                </div>
              )}

              <FormError message={error} />
              <button type="button" className="ui-btn ui-btn--primary ui-btn--block ag-confirm-btn" disabled={submitting} onClick={submitRequest}>
                {submitting ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending…</> : 'Request collection'}
              </button>
            </section>
            <p className="ui-safety"><Icons.locked size={16} aria-hidden="true" /> Your agent and Vochus both approve every collection before money is paid.</p>
          </>

        ) : (
          <>
            {plan ? (
              <section className="ui-card ag-collect-hero">
                <span className="ui-row-sub">{plan.goal ? `${plan.goal} · ` : ''}Available to collect</span>
                <p className="ag-status-amount">{formatNaira(plan.balance)}</p>
                {plan.balance > 0
                  ? <p className="ui-row-sub">You receive <strong className="ag-strong">{formatNaira(netPayout)}</strong> {savingsFee > 0 ? ` after ${flexDeduct ? (flexDeduct.penalty > 0 ? 'the early-stop charge' : 'the commission') : 'the platform fee'}${interest > 0 ? ' and interest' : ''}` : interest > 0 ? ' including interest' : ''}</p>
                  : <p className="ui-row-sub">Nothing saved in this plan yet. Save first, then you can collect.</p>}
                {isEarly && plan.balance > 0 && <p className="ag-early"><Icons.pending size={16} aria-hidden="true" /> Ends {formatDate(plan.maturityDate)}. Collecting now is an early collection.</p>}
                {inProgress ? (
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => openRedemption(inProgress)}>
                    {inProgress.status === 'Pending' ? 'Enter your code to confirm' : 'See your request'}
                  </button>
                ) : plan.balance > 0 ? (
                  <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => { setError(''); setStep('form') }}>Collect my savings</button>
                ) : null}
              </section>
            ) : (
              <section className="ui-card">
                <EmptyState icon="plan" title="Nothing to collect" text="You don’t have an active savings plan right now." />
              </section>
            )}

            {redemptions.length > 0 && (
              <>
                <div className="ui-section-head"><h2>Your requests</h2></div>
                <section className="ui-card ui-card--list">
                  {redemptions.map(r => {
                    const clickable = OPEN_REDEMPTION_STATUSES.includes(r.status) && !r.expired
                    const value = (
                      <span className="ui-value-stack ag-txn-value">
                        <span>{formatNaira(r.netPayout ?? 0)}</span>
                        <span className={`ui-status ui-status--sm ui-status--${statusTone(r.status)}`}>{r.expired ? 'Code expired' : statusLabel(r.status)}</span>
                      </span>
                    )
                    return (
                      <ListRow
                        key={r.id}
                        icon="withdraw"
                        title={r.reason || 'Collection'}
                        sub={formatDate(r.requestedAt)}
                        value={value}
                        onClick={clickable ? () => openRedemption(r) : undefined}
                      />
                    )
                  })}
                </section>
              </>
            )}
          </>
        )}
      </main>

      <CustomerBottomNav />
    </div>
  )
}
