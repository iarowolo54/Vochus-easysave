'use client'
import { useEffect, useState } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { formatDate, formatNaira } from '@/lib/format'
import { addDays, today } from '@/lib/plan-dates'

type Props = {
  open: boolean
  onClose: () => void
  /** Who is looking at the sheet: the customer themselves, or the agent acting for a customer. */
  who: { kind: 'customer' } | { kind: 'agent'; customerName: string }
  planName: string
  /** rollover: a matured plan keeps its money and starts a new term of the same length. again: a collected plan restarts. */
  kind?: 'rollover' | 'again'
  /** For a rollover: what stays and how long the new term is, so the person sees exactly what happens. */
  rollover?: { balance: number; periodDays: number }
  sendUrl: string
  confirmUrl: string
  /** Fields the server needs besides the code, e.g. the plan (and customer, for an agent). */
  body: Record<string, string>
  onDone: () => void
}

/** Sends a code to the customer (email or SMS, decided by the server) and rolls over / reopens the plan only once it is typed back. */
export default function ReopenCodeSheet({ open, onClose, who, planName, kind = 'again', rollover, sendUrl, confirmUrl, body, onDone }: Props) {
  const [resetId, setResetId] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [sentBy, setSentBy] = useState<'email' | 'sms'>('sms')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [wait, setWait] = useState(0)

  useEffect(() => { if (!open) { setResetId(''); setSentTo(''); setSentBy('sms'); setCode(''); setError(''); setBusy(false); setWait(0) } }, [open])
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(w => w - 1), 1000); return () => clearTimeout(t) }, [wait])
  const last4 = sentTo.slice(-4)

  const agent = who.kind === 'agent'
  const isRollover = kind === 'rollover'
  const title = isRollover ? 'Roll over' : 'Save again'
  const newEnd = rollover ? formatDate(addDays(today(), rollover.periodDays)) : ''
  const summary = isRollover && rollover
    ? `${agent ? 'Their' : 'Your'} ${formatNaira(rollover.balance, { minor: false })} stays in “${planName}”. A new ${rollover.periodDays}-day term starts today and ends on ${newEnd}. Nothing is paid out.`
    : `“${planName}” starts again from today, so you can keep saving into it.`
  const where = sentBy === 'email' ? `Sent to ${sentTo}.` : `Sent to the phone ending ${last4}.`

  async function send() {
    setBusy(true); setError('')
    try {
      const res = await fetch(sendUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? 'We couldn’t send the code. Try again.'); return }
      setResetId(d.resetId); setSentTo(d.sentTo); setSentBy(d.sentBy === 'email' ? 'email' : 'sms'); setCode(''); setWait(60)
    } catch { setError('We couldn’t reach the server. Check your connection and try again.') }
    finally { setBusy(false) }
  }

  async function confirm() {
    setBusy(true); setError('')
    try {
      const res = await fetch(confirmUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, resetId, code }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? 'That didn’t work. Try again.'); return }
      onDone()
    } catch { setError('We couldn’t reach the server. Check your connection and try again.') }
    finally { setBusy(false) }
  }

  return (
    <BottomSheet open={open} onClose={() => { if (!busy) onClose() }} title={title}>
      {!resetId ? (
        <>
          <p className="ui-row-sub" style={{ marginBottom: 10, color: 'var(--ui-ink)' }}>{summary}</p>
          <p className="ui-row-sub" style={{ marginBottom: 14 }}>
            {agent
              ? `${who.customerName} must agree. We’ll text a 6-digit code to their phone. Ask them to read it to you.`
              : 'To confirm it’s you, we’ll send you a 6-digit code.'}
          </p>
          <FormError message={error} />
          <div className="ui-stack">
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={busy} onClick={send}>
              {busy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending code…</> : 'Send the code'}
            </button>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={busy} onClick={onClose}>Not now</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ textAlign: 'center', padding: '4px 0 2px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ui-text, #111)' }}>
              {agent ? `Ask ${who.customerName} for the code` : sentBy === 'email' ? 'Enter the code we emailed you' : 'Enter the code we texted you'}
            </div>
            <p className="ui-row-sub" style={{ margin: '6px 0 0' }}>
              {agent ? (sentBy === 'email' ? `The text didn’t go through, so the code was emailed to ${sentTo}.` : `${who.customerName} will receive a 6-digit code on the phone ending ${last4}.`) : where} It works for 10 minutes.
            </p>
          </div>
          <div className="ag-tf-wrap">
            <input
              id="rc-code"
              aria-label={agent ? 'Code from the customer' : '6-digit code'}
              aria-invalid={!!error}
              className="ag-tf-input ag-tf-num"
              type="tel" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" autoFocus
              style={{ width: '100%', height: 64, textAlign: 'center', fontSize: 30, fontWeight: 800, letterSpacing: '0.45em', paddingLeft: '0.45em', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', border: `1.5px solid ${error ? '#c0392b' : 'var(--ui-border, #d8e8dd)'}`, borderRadius: 14, background: '#fff' }}
              value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
            />
            {error && <FieldError id="rc-code-error" message={error} />}
          </div>
          <div className="ui-stack">
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={busy || code.length !== 6} onClick={confirm}>
              {busy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Checking…</> : (isRollover ? 'Roll over' : 'Confirm and save again')}
            </button>
            <button type="button" className="ui-link" style={{ width: '100%', textAlign: 'center' }} disabled={busy || wait > 0} onClick={send}>
              {wait > 0 ? `Send a new code in ${wait}s` : 'Didn’t get it? Send a new code'}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}
