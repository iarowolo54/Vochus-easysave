'use client'
import { useCallback, useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import EmptyState from '@/components/ui/EmptyState'
import LogoLoader from '@/components/ui/LogoLoader'
import { Icons } from '@/components/ui/icons'
import { formatNaira } from '@/lib/format'
import { describeFailure, postJson } from '@/lib/http'
import { setJustPaid } from '@/lib/payment-flash'

type State =
  | { kind: 'confirming' }
  | { kind: 'success'; amount: number | null; newBalance: number | null; already: boolean; notBought: NotBought }
  | { kind: 'review' }         // money arrived but can't be credited as it stands; staff are looking at it
  | { kind: 'failed' }        // Paystack says the payment did not succeed
  | { kind: 'unconfirmed' }   // we couldn't reach a verdict (network, server, timeout)
  // Auto-funding set-up (refs from /api/customer/auto-debit/init start with `addenroll-`)
  | { kind: 'autoOn'; already: boolean }
  | { kind: 'autoSavedInstead' } // the card can't be reused, but the first payment was saved
  | { kind: 'autoFailed'; message: string; canRetry: boolean }

type NotBought = { count: number; weekly: boolean } | null

const ENROLL_PREFIX = 'addenroll-'
/** Server reasons arrive without a full stop ("Card cannot be used for auto-debit"). */
const sentence = (m: string) => /[.!?]$/.test(m) ? m : `${m}.`

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const reference = searchParams.get('reference') ?? searchParams.get('trxref') ?? ''
  const [state, setState] = useState<State>({ kind: 'confirming' })
  const [copied, setCopied] = useState(false)

  const enrolling = reference.startsWith(ENROLL_PREFIX)

  const check = useCallback(async () => {
    if (!reference) { setState({ kind: 'unconfirmed' }); return }
    setState({ kind: 'confirming' })
    if (reference.startsWith(ENROLL_PREFIX)) {
      const r = await postJson<{ active?: boolean; alreadyProcessed?: boolean; savedInstead?: boolean; review?: boolean }>(
        '/api/customer/auto-debit/verify', { reference },
      )
      if (r.ok && r.data.review) { setState({ kind: 'review' }); return }
      if (r.ok) {
        setState(r.data.active ? { kind: 'autoOn', already: !!r.data.alreadyProcessed } : { kind: 'autoSavedInstead' })
        return
      }
      // 4xx: show the server's reason as-is. Network/5xx: we don't know yet, so offer to check again.
      const definite = r.kind === 'http' && r.status >= 400 && r.status < 500
      setState({ kind: 'autoFailed', message: describeFailure(r), canRetry: !definite })
      return
    }
    const r = await postJson<{ amount?: number; newBalance?: number; alreadyProcessed?: boolean; review?: boolean; pending?: boolean; notBought?: NotBought }>(
      '/api/customer/paystack/verify', { reference },
    )
    if (r.ok && r.data.review) { setState({ kind: 'review' }); return }
    // Still settling, such as a bank transfer. It hasn't failed, so don't say it has.
    if (r.ok && r.data.pending) { setState({ kind: 'unconfirmed' }); return }
    if (r.ok && (r.data.alreadyProcessed || r.data.amount)) {
      const amount = r.data.amount ?? null
      if (amount && !r.data.alreadyProcessed) setJustPaid(amount)
      setState({ kind: 'success', amount, newBalance: r.data.newBalance ?? null, already: !!r.data.alreadyProcessed, notBought: r.data.notBought?.count ? r.data.notBought : null })
      return
    }
    if (!r.ok && r.kind === 'http' && r.status === 400 && /not successful/i.test(r.serverMessage)) {
      setState({ kind: 'failed' })
      return
    }
    setState({ kind: 'unconfirmed' })
  }, [reference])

  useEffect(() => { check() }, [check])

  async function copyRef() {
    try { await navigator.clipboard.writeText(reference); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {}
  }

  const refLine = reference && (
    <p className="ui-note ui-note--center ui-callback-ref">
      Reference <span>{reference}</span>
      <button type="button" className="ui-link" onClick={copyRef}>{copied ? 'Copied' : 'Copy'}</button>
    </p>
  )

  if (state.kind === 'confirming') return (
    <div className="ui-screen ui-screen--center">
      <div className="ui-empty">
        <LogoLoader size={96} label={enrolling ? 'Linking your card…' : 'Confirming your payment…'} />
        <p className="ui-empty-title ui-gap-top">{enrolling ? 'Linking your card…' : 'Confirming your payment…'}</p>
        <p className="ui-empty-text">This takes a few seconds. Please don’t close the app or pay again.</p>
      </div>
    </div>
  )

  const home = <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => router.push('/customer/dashboard')}>Back to home</button>

  if (state.kind === 'autoOn') return (
    <div className="ui-screen ui-screen--center">
      <EmptyState
        icon="check"
        title={state.already ? 'Auto-funding is already on' : 'Auto-funding is on'}
        text="Your card is linked and your first payment is in your savings. We’ll save for you on your plan’s schedule until it ends. You can turn it off anytime from home."
        action={<div className="ui-stack">{home}{refLine}</div>}
      />
    </div>
  )

  if (state.kind === 'autoSavedInstead') return (
    <div className="ui-screen ui-screen--center">
      <EmptyState
        icon="card"
        title="This card can’t auto-fund"
        text="Your payment was added to your savings, but this card can’t be charged automatically. Try again with a different card to turn on auto-funding."
        action={<div className="ui-stack">{home}{refLine}</div>}
      />
    </div>
  )

  if (state.kind === 'autoFailed') return (
    <div className="ui-screen ui-screen--center">
      <EmptyState
        icon={state.canRetry ? 'pending' : 'error'}
        tone={state.canRetry ? undefined : 'danger'}
        title={state.canRetry ? 'We’re still checking your card' : 'Auto-funding wasn’t turned on'}
        text={state.canRetry
          ? `${sentence(state.message)} Don’t set it up again yet.`
          : `${sentence(state.message)} If money left your account, contact support with the reference below.`}
        action={
          <div className="ui-stack">
            {state.canRetry
              ? <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={check}><Icons.retry size={18} aria-hidden="true" /> Check again</button>
              : home}
            <button type="button" className="ui-btn ui-btn--plain ui-btn--block" onClick={() => router.push('/customer/chat')}>Get help</button>
            {refLine}
          </div>
        }
      />
    </div>
  )

  if (state.kind === 'review') return (
    <div className="ui-screen ui-screen--center">
      <EmptyState
        icon="pending"
        title="We’re reviewing this payment"
        text="Your money arrived, but it couldn’t be added to this plan automatically. Our team is checking it. Please don’t pay again; contact support with the reference below if you need to."
        action={
          <div className="ui-stack">
            {home}
            <button type="button" className="ui-btn ui-btn--plain ui-btn--block" onClick={() => router.push('/customer/chat')}>Get help</button>
            {refLine}
          </div>
        }
      />
    </div>
  )

  if (state.kind === 'success' && state.notBought) {
    const unit = state.notBought.weekly ? 'week' : 'day'
    const many = state.notBought.count !== 1
    return (
      <div className="ui-screen ui-screen--center">
        <EmptyState
          icon="pending"
          title={`${state.notBought.count} ${unit}${many ? 's' : ''} not paid for`}
          text={`${state.amount ? formatNaira(state.amount) : 'Your money'} is in your savings, but this payment wasn’t applied to ${state.notBought.count} of the ${unit}s you picked. Check your savings card to see what’s paid.`}
          action={<div className="ui-stack">{home}{refLine}</div>}
        />
      </div>
    )
  }

  if (state.kind === 'success') return (
    <div className="ui-screen ui-screen--center">
      <EmptyState
        icon="check"
        title={state.already ? 'Payment already recorded' : 'Payment received'}
        text={state.amount ? `${formatNaira(state.amount)} has been added to your savings.` : 'This payment is already in your savings.'}
        action={
          <div className="ui-stack">
            {state.newBalance !== null && <p className="ui-callback-balance">New balance <strong>{formatNaira(state.newBalance)}</strong></p>}
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => router.push('/customer/dashboard')}>Back to home</button>
            {refLine}
          </div>
        }
      />
    </div>
  )

  if (state.kind === 'failed') return (
    <div className="ui-screen ui-screen--center">
      <EmptyState
        icon="error"
        tone="danger"
        title="Payment didn’t go through"
        text="This payment wasn’t completed, so nothing was added to your savings. You can try again, or use another card or bank."
        action={
          <div className="ui-stack">
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => router.push('/customer/save')}>Try again</button>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => router.push('/customer/dashboard')}>Back to home</button>
            {refLine}
          </div>
        }
      />
    </div>
  )

  return (
    <div className="ui-screen ui-screen--center">
      <EmptyState
        icon="pending"
        title="We’re still confirming this payment"
        text="We couldn’t get an answer just now. If money left your account, don’t pay again — it will be added to your savings once the payment is confirmed."
        action={
          <div className="ui-stack">
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={check}>
              <Icons.retry size={18} aria-hidden="true" /> Check again
            </button>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => router.push('/customer/transactions')}>See my history</button>
            <button type="button" className="ui-btn ui-btn--plain ui-btn--block" onClick={() => router.push('/customer/chat')}>Get help</button>
            {refLine}
          </div>
        }
      />
    </div>
  )
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<div className="ui-screen ui-screen--center"><LogoLoader delayed /></div>}>
      <CallbackContent />
    </Suspense>
  )
}
