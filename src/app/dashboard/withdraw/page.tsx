'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { formatDate, formatNaira, formatTime } from '@/lib/format'
import AmountField from '@/components/ui/AmountField'
import EmptyState from '@/components/ui/EmptyState'
import { FormError } from '@/components/ui/FormErrors'
import { Bone, ListSkeleton } from '@/components/ui/Skeleton'
import Toast from '@/components/ui/Toast'
import { Icons } from '@/components/ui/icons'

interface Withdrawal {
  id: string
  ref: string
  amount: number
  status: string
  note: string | null
  bankName: string | null
  accountNumber: string | null
  accountName: string | null
  bankTransferStatus: string | null
  adminNote: string | null
  requestedAt: string
  decidedAt: string | null
  decidedBy: string | null
}

interface Bank {
  bankCode?: string
  bankName?: string
  accountNumber?: string
  accountName?: string
}

const STATUS: Record<string, { label: string; tone: 'warn' | 'success' | 'danger' | 'neutral' }> = {
  Pending: { label: 'Waiting for approval', tone: 'warn' },
  AwaitingOTP: { label: 'Approved · sending', tone: 'warn' },
  Finalizing: { label: 'Approved · sending', tone: 'warn' },
  Approved: { label: 'Paid', tone: 'success' },
  Rejected: { label: 'Declined', tone: 'danger' },
}
const statusOf = (s: string) => STATUS[s] ?? { label: s, tone: 'neutral' as const }

const STEPS = [
  { label: 'Requested', hint: 'The amount is held from your commission.' },
  { label: 'Admin approval', hint: 'An admin checks your request. You’ll see the decision here.' },
  { label: 'Sent to your bank', hint: 'Paystack transfers the money once it’s approved.' },
]

const last4 = (n?: string | null) => (n ? `•••• ${n.slice(-4)}` : '')

export default function WithdrawPage() {
  const [commissionBalance, setCommissionBalance] = useState(0)
  const [bank, setBank] = useState<Bank | null>(null)
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [minWithdrawal, setMinWithdrawal] = useState(500)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/agent/withdrawal')
      if (res.ok) {
        const d = await res.json()
        setCommissionBalance(d.commissionBalance ?? 0)
        setBank(d.bank ?? null)
        setWithdrawals(d.withdrawals ?? [])
        setMinWithdrawal(d.minWithdrawal ?? 500)
        setLoadFailed(false)
      } else {
        setLoadFailed(true)
      }
    } catch {
      setLoadFailed(true)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const pending = withdrawals.find(w => ['Pending', 'AwaitingOTP', 'Finalizing'].includes(w.status)) ?? null
  const hasPending = !!pending
  const hasBank = !!bank?.accountNumber
  const locked = hasPending || !hasBank

  async function submit() {
    setError('')
    const amt = parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter an amount to withdraw.'); return }
    if (amt > commissionBalance) { setError(`That’s more than your available ${formatNaira(commissionBalance)}.`); return }
    setSubmitting(true)
    let res: Response
    let d: { error?: string }
    try {
      res = await fetch('/api/agent/withdrawal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, note }),
      })
      d = await res.json().catch(() => ({}))
    } catch {
      setSubmitting(false)
      setError('We lost the connection. Check your requests below before trying again.')
      load(); return
    }
    setSubmitting(false)
    if (!res.ok) { setError(d.error ?? 'The request couldn’t be sent. Please try again.'); return }
    setAmount(''); setNote('')
    setToast('Request sent. An admin will review it.')
    load()
  }

  const amt = parseFloat(amount) || 0
  const tooMuch = amt > commissionBalance
  const pendingStep = pending ? (pending.status === 'AwaitingOTP' || pending.status === 'Finalizing' ? 2 : 1) : 0

  return (
    <div className="ag-page">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}

      {loading && withdrawals.length === 0 && !loadFailed ? (
        <div className="ag-home-grid ag-wallet-grid ui-skeleton" aria-hidden="true">
          <div className="ag-col"><div className="ui-card ag-topup"><Bone h={72} /><Bone h={64} w="60%" center /><Bone h={52} /></div></div>
          <div className="ag-col"><ListSkeleton count={3} /></div>
        </div>
      ) : loadFailed && withdrawals.length === 0 ? (
        <section className="ui-card">
          <EmptyState icon="error" tone="danger" title="Couldn’t load your commission" text="Check your connection and try again."
            action={<button type="button" className="ui-btn ui-btn--secondary" onClick={load}><Icons.retry size={18} aria-hidden="true" /> Try again</button>} />
        </section>
      ) : (
        <div className="ag-home-grid ag-wallet-grid">
          <div className="ag-col">
            {pending && (
              <>
              <div className="ui-section-head"><h2>In progress</h2></div>
              <section className="ui-card ag-track" aria-label="Request in progress">
                <div className="ag-track-head">
                  <div>
                    <span className="ui-row-sub ui-block">Requested {formatDate(pending.requestedAt)}</span>
                    <span className="ag-funded-value">{formatNaira(pending.amount)}</span>
                  </div>
                  <span className={`ui-status ui-status--sm ui-status--${statusOf(pending.status).tone}`}>{statusOf(pending.status).label}</span>
                </div>
                <ol className="ui-steps">
                  {STEPS.map((step, i) => {
                    const state = i < pendingStep ? 'done' : i === pendingStep ? 'current' : 'todo'
                    return (
                      <li key={step.label} className={`ui-step ui-step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                        <span className="ui-step-dot" aria-hidden="true">{state === 'done' && <Icons.check size={14} />}</span>
                        <span>
                          <span className="ui-step-label">{step.label}</span>
                          {state === 'current' && <span className="ui-step-hint">{step.hint}</span>}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              </section>
              </>
            )}
            <div className="ui-section-head"><h2 id="wd-title">New request</h2></div>
            <section className="ui-card ag-topup" aria-labelledby="wd-title">
              <div className="ag-topup-balance">
                <span className="ag-topup-icon" aria-hidden="true"><Icons.commission size={22} /></span>
                <span>
                  <span className="ui-row-sub ui-block">Available to withdraw</span>
                  <span className="ag-topup-balance-value">{formatNaira(commissionBalance)}</span>
                </span>
              </div>

              {!hasBank ? (
                <div className="ui-banner ui-banner--warn">
                  <Icons.error size={18} aria-hidden="true" />
                  <div>Add the bank account you want to be paid into first. <Link href="/dashboard/settings" className="ag-banner-link">Add it in Settings</Link></div>
                </div>
              ) : (
                <div className="ag-payee">
                  <span className="ui-row-icon" aria-hidden="true"><Icons.loan size={20} /></span>
                  <span className="ag-payee-main">
                    <span className="ui-row-sub ui-block">Paid into</span>
                    <span className="ui-row-title ui-block">{bank?.accountName || bank?.bankName}</span>
                    <span className="ui-row-sub ui-block">{bank?.accountName ? `${bank.bankName} · ` : ''}{last4(bank?.accountNumber)}</span>
                  </span>
                  <Link href="/dashboard/settings" className="ui-link">Change</Link>
                </div>
              )}

              {hasPending && (
                <div className="ui-banner ui-banner--info">
                  <Icons.pending size={18} aria-hidden="true" />
                  <div>You can ask for another withdrawal once the one in progress has been decided.</div>
                </div>
              )}

              <FormError message={error} />

              <AmountField
                value={amount}
                onChange={v => { setAmount(v); setError('') }}
                invalid={tooMuch}
                disabled={locked}
                hint={tooMuch ? `More than your available ${formatNaira(commissionBalance)}` : `Minimum ${formatNaira(minWithdrawal, { minor: false })}`}
              />
              {commissionBalance > 0 && !locked && (
                <div className="ag-quick">
                  <button type="button" className="ag-chip" aria-pressed={amount === commissionBalance.toFixed(2)} onClick={() => setAmount(commissionBalance.toFixed(2))}>
                    Withdraw all · {formatNaira(commissionBalance, { minor: false })}
                  </button>
                </div>
              )}

              <div className="ui-field ag-note-field">
                <label className="ui-label" htmlFor="wd-note">Note for the admin <span className="ui-link--muted">(optional)</span></label>
                <textarea id="wd-note" className="ui-input ag-textarea" rows={2} placeholder="Anything they should know"
                  value={note} onChange={e => setNote(e.target.value)} disabled={locked} />
              </div>

              <dl className="ag-done-rows ag-topup-rows">
                <div><dt>You receive</dt><dd>{amt > 0 && !tooMuch ? formatNaira(amt) : '—'}</dd></div>
                <div><dt>Commission left</dt><dd>{amt > 0 && !tooMuch ? formatNaira(commissionBalance - amt) : '—'}</dd></div>
              </dl>

              <button type="button" className="ui-btn ui-btn--primary ui-btn--block ag-topup-btn"
                disabled={submitting || locked || !amount || tooMuch} onClick={submit}>
                {submitting
                  ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending request…</>
                  : amt > 0 ? `Request ${formatNaira(amt, { minor: false })}` : 'Request withdrawal'}
              </button>
              <p className="ui-note ui-note--center"><Icons.locked size={16} aria-hidden="true" /> An admin approves every withdrawal before it’s paid</p>
            </section>
          </div>

          <div className="ag-col">
            <div className="ui-section-head"><h2>All requests</h2></div>


            {withdrawals.length === 0 ? (
              <section className="ui-card">
                <EmptyState icon="withdraw" title="No withdrawals yet" text="Your requests and their progress will show here." />
              </section>
            ) : (
              <section className="ui-card ui-card--list" aria-label="Withdrawal history">
                {withdrawals.map(w => {
                  const st = statusOf(w.status)
                  return (
                    <div key={w.id} className="ui-row ag-wd-row">
                      <span className={`ui-row-icon${w.status === 'Rejected' ? ' ag-icon-danger' : ''}`} aria-hidden="true">
                        {w.status === 'Approved' ? <Icons.check size={20} /> : w.status === 'Rejected' ? <Icons.close size={20} /> : <Icons.pending size={20} />}
                      </span>
                      <span className="ui-row-main">
                        <span className="ui-row-title ui-block">{formatNaira(w.amount)}</span>
                        <span className="ui-row-sub ui-block">{last4(w.accountNumber)} · {formatDate(w.requestedAt)}, {formatTime(w.requestedAt)}</span>
                        {w.adminNote && <span className="ag-admin-note">“{w.adminNote}”</span>}
                      </span>
                      <span className={`ui-status ui-status--sm ui-status--${st.tone}`}>{st.label}</span>
                    </div>
                  )
                })}
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
