'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import EmptyState from '@/components/ui/EmptyState'
import { Icons } from '@/components/ui/icons'
import { formatNaira } from '@/lib/format'

export type TransferDetails = {
  ref: string
  payAmount: number
  expiresAt: string
  account: { bank: string; number: string; name: string }
}

type Status = 'pending' | 'done' | 'review' | 'expired' | 'closed' | 'cancelled'

const POLL_MS = 5000

/** Shows where to send the money and waits for the bank's credit alert to be matched on the server. */
export default function TransferPanel({ details, statusUrl, cancelUrl, destination, balanceLabel, doneHref, historyHref, onDone, onClose }: {
  details: TransferDetails
  /** The status route; the reference is added to it. */
  statusUrl: string
  /** Closes the request on the server; the reference is sent in the body. */
  cancelUrl: string
  /** Where the money went, e.g. a plan name or "your wallet". */
  destination: string
  balanceLabel: string
  doneHref: string
  historyHref: string
  /** Called once when the money has been credited. */
  onDone?: (newBalance: number | null) => void
  onClose: () => void
}) {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('pending')
  const [balance, setBalance] = useState<number | null>(null)
  const [left, setLeft] = useState(() => Math.max(0, new Date(details.expiresAt).getTime() - Date.now()))
  const [copied, setCopied] = useState('')
  const [checkFailed, setCheckFailed] = useState(false)
  const [checking, setChecking] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelFailed, setCancelFailed] = useState(false)
  // 'ask' = "did you include the kobo?" after tapping "I've sent it"; 'left-out' = they say they didn't.
  const [sentCheck, setSentCheck] = useState<'idle' | 'ask' | 'left-out'>('idle')
  const alive = useRef(true)
  const askRef = useRef<HTMLDivElement>(null)
  const notified = useRef(false)
  // Held in a ref so a parent that passes a new function each render can't restart the polling timer.
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const res = await fetch(`${statusUrl}?ref=${encodeURIComponent(details.ref)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('status')
      const body: { status: Status; newBalance?: number } = await res.json()
      if (!alive.current) return
      setCheckFailed(false)
      if (body.newBalance !== undefined) setBalance(body.newBalance)
      setStatus(body.status)
      if ((body.status === 'done' || body.status === 'closed') && !notified.current) { notified.current = true; onDoneRef.current?.(body.newBalance ?? null) }
    } catch {
      if (alive.current) setCheckFailed(true)
    } finally {
      if (alive.current) setChecking(false)
    }
  }, [details.ref, statusUrl])

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  // On a phone the question opens below the fold; bring it up so it can't be missed.
  useEffect(() => {
    if (sentCheck !== 'idle') askRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [sentCheck])

  useEffect(() => {
    if (status !== 'pending') return
    const tick = setInterval(() => setLeft(Math.max(0, new Date(details.expiresAt).getTime() - Date.now())), 1000)
    const poll = setInterval(check, POLL_MS)
    return () => { clearInterval(tick); clearInterval(poll) }
  }, [status, check, details.expiresAt])

  // The server closes the request first, so a late "I've sent it" can't be credited to a screen that has gone.
  // If it says no (already paid, or closed another way) we look again instead of closing the screen on a lie.
  async function cancel() {
    setCancelling(true)
    setCancelFailed(false)
    try {
      const res = await fetch(cancelUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: details.ref }) })
      if (!res.ok) throw new Error('cancel')
      const body: { cancelled: boolean } = await res.json()
      if (!alive.current) return
      if (body.cancelled) onClose()
      else await check()
    } catch {
      if (alive.current) setCancelFailed(true)
    } finally {
      if (alive.current) setCancelling(false)
    }
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      setTimeout(() => setCopied(c => (c === label ? '' : c)), 1500)
    } catch {
      setCopied('')
    }
  }

  const mins = Math.floor(left / 60000)
  const secs = String(Math.floor((left % 60000) / 1000)).padStart(2, '0')
  const exact = formatNaira(details.payAmount)
  // The whole naira and the kobo are drawn apart so the kobo, the part people leave out, can be the loudest thing on the screen.
  const wholeNaira = Math.floor(details.payAmount + 1e-9)
  const kobo = String(Math.round((details.payAmount - wholeNaira) * 100)).padStart(2, '0')

  if (status === 'done') {
    return (
      <EmptyState
        icon="check"
        title={`${exact} received`}
        text={balance !== null ? `It’s in ${destination}. ${balanceLabel} is now ${formatNaira(balance)}.` : `It’s in ${destination}.`}
        action={<button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => router.push(doneHref)}>Done</button>}
      />
    )
  }

  // Our team credited this payment another way (held money matched to this person). Don't show the pay-in amount again.
  if (status === 'closed') {
    return (
      <EmptyState
        icon="check"
        title="Your payment has been credited"
        text={balance !== null ? `Our team has credited your payment to ${destination}. ${balanceLabel} is now ${formatNaira(balance)}. You don’t need to send it again.` : `Our team has credited your payment to ${destination}. You don’t need to send it again.`}
        action={<button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => router.push(doneHref)}>Done</button>}
      />
    )
  }

  if (status === 'review') {
    return (
      <EmptyState
        icon="pending"
        title="We’re checking your payment"
        text="We got your money but need to check it before it shows in your plan. We’ll sort it out soon. You don’t need to send it again."
        action={<button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => router.push(doneHref)}>Back</button>}
      />
    )
  }

  if (status === 'cancelled') {
    return (
      <EmptyState
        icon="error"
        title="This transfer was cancelled"
        text="Don’t send money to this account for this request. If you already did, tell us and we’ll find it. Otherwise start again to get a fresh amount."
        action={<button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={onClose}>Start again</button>}
      />
    )
  }

  if (status === 'expired' || left === 0) {
    return (
      <EmptyState
        icon="error"
        tone="danger"
        title="This transfer has timed out"
        text="If you already sent the money, give us a few minutes and check your plan. If not, start again to get a fresh amount."
        action={
          <div className="ui-stack">
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={onClose}>Start again</button>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => router.push(historyHref)}>See my history</button>
          </div>
        }
      />
    )
  }

  const rows: { label: string; value: string; copyValue?: string }[] = [
    { label: 'Bank', value: details.account.bank },
    { label: 'Account number', value: details.account.number, copyValue: details.account.number },
    { label: 'Account name', value: details.account.name },
  ]

  return (
    <>
      <section className="tp-hero" aria-label="Amount to send">
        <p className="tp-hero-kicker">Send exactly this amount</p>
        <p className="tp-figure" aria-label={exact}>
          <span className="tp-whole" aria-hidden="true">{formatNaira(wholeNaira, { minor: false })}</span>
          <span className="tp-kobo" aria-hidden="true">.{kobo}</span>
        </p>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => copy('amount', details.payAmount.toFixed(2))}>
          {copied === 'amount' ? 'Copied. Now paste it in your bank app' : `Copy ${exact}`}
        </button>
      </section>

      <div className="tp-callout" role="alert">
        <p className="tp-callout-title">Don’t leave out the .{kobo}</p>
        <p className="tp-callout-text">It’s how we know the payment is yours. It’s not a fee: all {exact} goes into {destination}. Without the .{kobo}, your money is held until our team checks it by hand.</p>
      </div>

      <dl className="ui-card ui-card--list ui-review-rows">
        {rows.map(r => (
          <div className="ui-row" key={r.label}>
            <dt className="ui-row-main ui-row-sub">{r.label}</dt>
            <dd className="ui-review-value">
              {r.value}
              {r.copyValue && (
                <button type="button" className="ui-link" onClick={() => copy(r.label, r.copyValue!)}>
                  {copied === r.label ? 'Copied' : 'Copy'}
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <p className="ui-note ui-note--center" role="status" aria-live="polite">
        <Icons.pending size={14} aria-hidden="true" /> Waiting for your transfer · {mins}:{secs} left
      </p>
      {checkFailed && <p className="ui-note ui-note--center">We couldn’t check just now. We’ll keep trying.</p>}

      {sentCheck === 'idle' && (
        <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => { setSentCheck('ask'); void check() }} disabled={checking} aria-busy={checking}>
          {checking ? 'Checking…' : 'I’ve sent it'}
        </button>
      )}
      {sentCheck === 'ask' && (
        <div ref={askRef} className="tp-callout tp-callout--ask" role="group" aria-label="Check the amount you sent">
          <p className="tp-callout-title">Did the amount you sent end in .{kobo}?</p>
          <p className="tp-callout-text">Look at your bank app’s receipt. It should say {exact}.</p>
          <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => { setSentCheck('idle'); void check() }}>Yes, it ended in .{kobo}</button>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--block ui-gap-top" onClick={() => setSentCheck('left-out')}>No, I left it out</button>
        </div>
      )}
      {sentCheck === 'left-out' && (
        <div ref={askRef} className="tp-callout" role="alert">
          <p className="tp-callout-title">Don’t send it again</p>
          <p className="tp-callout-text">Money sent without the .{kobo} can’t be matched to you automatically. Our team checks it by hand and credits it to {destination}, which takes longer than usual. Sending it twice would only leave you with two payments to sort out.</p>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => router.push(doneHref)}>OK</button>
        </div>
      )}
      {cancelFailed && <p className="ui-note ui-note--center" role="alert">We couldn’t cancel just now. Check your connection and try again.</p>}
      <button type="button" className="ui-btn ui-btn--secondary ui-btn--block ui-gap-top" onClick={cancel} disabled={cancelling} aria-busy={cancelling}>
        {cancelling ? 'Cancelling…' : 'Cancel'}
      </button>
    </>
  )
}
