'use client'
import { useEffect, useState } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import { FieldError, FormError } from '@/components/ui/FormErrors'

/** "ada@gmail.com" -> "a••@gmail.com" */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@')
  return domain ? `${name.slice(0, 1)}••@${domain}` : email
}

type Props = { open: boolean; onClose: () => void; email: string; onConfirmed: () => void }

/** Sends a code to the customer's own email on file and turns alerts on once they type it back. */
export default function EmailAlertsSheet({ open, onClose, email, onConfirmed }: Props) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (!open) { setSent(false); setCode(''); setError(''); setBusy(false) } }, [open])

  async function send() {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/customer/email-alerts/code', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? 'We couldn’t send the code. Try again.'); return }
      setSent(true)
    } catch { setError('We couldn’t reach the server. Check your connection and try again.') }
    finally { setBusy(false) }
  }

  async function confirm() {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/customer/email-alerts/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? 'That didn’t work. Try again.'); return }
      onConfirmed()
    } catch { setError('We couldn’t reach the server. Check your connection and try again.') }
    finally { setBusy(false) }
  }

  return (
    <BottomSheet open={open} onClose={() => { if (!busy) onClose() }} title="Get alerts by email">
      {!sent ? (
        <>
          <p className="ui-row-sub">We’ll email you when someone signs in to your account and when a payment reaches your savings. To start, confirm this is your email: {maskEmail(email)}</p>
          <FormError message={error} />
          <div className="ui-stack">
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={busy} onClick={send}>
              {busy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending code…</> : 'Send me a code'}
            </button>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={busy} onClick={onClose}>Not now</button>
          </div>
        </>
      ) : (
        <>
          <p className="ui-row-sub">We sent a 6-digit code to {maskEmail(email)}. It works for 10 minutes.</p>
          <div className="ag-tf-wrap">
            <div className={`ag-tf${error ? ' is-invalid' : ''}`}>
              <label className="ag-tf-label" htmlFor="ea-code">6-digit code</label>
              <input id="ea-code" className="ag-tf-input ag-tf-num" type="tel" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} />
            </div>
            {error && <FieldError id="ea-code-error" message={error} />}
          </div>
          <div className="ui-stack">
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={busy || code.length !== 6} onClick={confirm}>
              {busy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Checking…</> : 'Confirm and turn on alerts'}
            </button>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={busy} onClick={send}>Send a new code</button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}
