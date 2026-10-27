'use client'
import { useCallback, useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import EmptyState from '@/components/ui/EmptyState'
import { Icons } from '@/components/ui/icons'
import { formatNaira } from '@/lib/format'
import { postJson } from '@/lib/http'
import { setJustPaid } from '@/lib/payment-flash'

type State =
  | { kind: 'confirming' }
  | { kind: 'success'; amount: number | null; newBalance: number | null; already: boolean }
  | { kind: 'failed' }        // Paystack says the payment did not succeed
  | { kind: 'unconfirmed' }   // we couldn't reach a verdict (network, server, timeout)

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const reference = searchParams.get('reference') ?? searchParams.get('trxref') ?? ''
  const [state, setState] = useState<State>({ kind: 'confirming' })
  const [copied, setCopied] = useState(false)

  const check = useCallback(async () => {
    if (!reference) { setState({ kind: 'unconfirmed' }); return }
    setState({ kind: 'confirming' })
    const r = await postJson<{ amount?: number; newBalance?: number; alreadyProcessed?: boolean }>(
      '/api/customer/paystack/verify', { reference },
    )
    if (r.ok && (r.data.alreadyProcessed || r.data.amount)) {
      const amount = r.data.amount ?? null
      if (amount && !r.data.alreadyProcessed) setJustPaid(amount)
      setState({ kind: 'success', amount, newBalance: r.data.newBalance ?? null, already: !!r.data.alreadyProcessed })
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
    <div className="ui-screen ui-screen--center" role="status">
      <div className="ui-empty">
        <div className="ui-spinner" style={{ margin: '0 auto var(--ui-s4)' }} />
        <p className="ui-empty-title">Confirming your payment…</p>
        <p className="ui-empty-text">This takes a few seconds. Please don’t close the app or pay again.</p>
      </div>
    </div>
  )

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
        text="Paystack didn’t complete this payment, so nothing was added to your savings. You can try again, or use another card or bank."
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
        text="We couldn’t get an answer just now. If money left your account, don’t pay again — it will be added to your savings once Paystack confirms it."
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
    <Suspense fallback={<div className="ui-screen ui-screen--center"><div className="ui-spinner" /></div>}>
      <CallbackContent />
    </Suspense>
  )
}
