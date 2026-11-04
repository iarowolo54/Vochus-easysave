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

type Status = 'pending' | 'done' | 'review' | 'expired'

const POLL_MS = 5000

/** Shows where to send the money and waits for the bank's credit alert to be matched on the server. */
export default function TransferPanel({ details, planName, onClose }: { details: TransferDetails; planName: string; onClose: () => void }) {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('pending')
  const [balance, setBalance] = useState<number | null>(null)
  const [left, setLeft] = useState(() => Math.max(0, new Date(details.expiresAt).getTime() - Date.now()))
  const [copied, setCopied] = useState('')
  const [checkFailed, setCheckFailed] = useState(false)
  const [checking, setChecking] = useState(false)
  const alive = useRef(true)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const res = await fetch(`/api/customer/transfer/status?ref=${encodeURIComponent(details.ref)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('status')
      const body: { status: Status; newBalance?: number } = await res.json()
      if (!alive.current) return
      setCheckFailed(false)
      if (body.newBalance !== undefined) setBalance(body.newBalance)
      setStatus(body.status)
    } catch {
      if (alive.current) setCheckFailed(true)
    } finally {
      if (alive.current) setChecking(false)
    }
  }, [details.ref])

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    if (status !== 'pending') return
    const tick = setInterval(() => setLeft(Math.max(0, new Date(details.expiresAt).getTime() - Date.now())), 1000)
    const poll = setInterval(check, POLL_MS)
    return () => { clearInterval(tick); clearInterval(poll) }
  }, [status, check, details.expiresAt])

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

  if (status === 'done') {
    return (
      <EmptyState
        icon="check"
        title={`${exact} received`}
        text={balance !== null ? `It’s in ${planName}. Your balance is now ${formatNaira(balance)}.` : `It’s in ${planName}.`}
        action={<button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => router.push('/customer/dashboard')}>Done</button>}
      />
    )
  }

  if (status === 'review') {
    return (
      <EmptyState
        icon="pending"
        title="We’re checking your payment"
        text="We got your money but need to check it before it shows in your plan. We’ll sort it out soon. You don’t need to send it again."
        action={<button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => router.push('/customer/dashboard')}>Back to home</button>}
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
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={() => router.push('/customer/transactions')}>See my transactions</button>
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
      <section className="ui-review" aria-label="Transfer details">
        <p className="ui-review-kicker">Send this exact amount</p>
        <h2 className="ui-review-title ui-amount">{exact}</h2>
        <button type="button" className="ui-link" onClick={() => copy('amount', details.payAmount.toFixed(2))}>
          {copied === 'amount' ? 'Copied' : 'Copy amount'}
        </button>
      </section>

      <p className="ui-note" role="alert">
        <Icons.error size={14} aria-hidden="true" /> Send exactly {exact}, not a rounded figure. Any other amount can’t be matched to you automatically and will be held for checking.
      </p>

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

      <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={check} disabled={checking} aria-busy={checking}>
        {checking ? 'Checking…' : 'I’ve sent it'}
      </button>
      <button type="button" className="ui-btn ui-btn--secondary ui-btn--block ui-gap-top" onClick={onClose}>Cancel</button>
    </>
  )
}
