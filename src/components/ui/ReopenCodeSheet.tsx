'use client'
import { useEffect, useState } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import { FieldError, FormError } from '@/components/ui/FormErrors'

type Props = {
  open: boolean
  onClose: () => void
  /** Who is looking at the sheet: the customer themselves, or the agent acting for a customer. */
  who: { kind: 'customer' } | { kind: 'agent'; customerName: string }
  planName: string
  sendUrl: string
  confirmUrl: string
  /** Fields the server needs besides the code, e.g. the plan (and customer, for an agent). */
  body: Record<string, string>
  onDone: () => void
}

/** Texts a code to the customer and reopens the plan only once it has been typed back. */
export default function ReopenCodeSheet({ open, onClose, who, planName, sendUrl, confirmUrl, body, onDone }: Props) {
  const [resetId, setResetId] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (!open) { setResetId(''); setSentTo(''); setCode(''); setError(''); setBusy(false) } }, [open])

  const agent = who.kind === 'agent'

  async function send() {
    setBusy(true); setError('')
    try {
      const res = await fetch(sendUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? 'We couldn’t send the code. Try again.'); return }
      setResetId(d.resetId); setSentTo(d.sentTo); setCode('')
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
    <BottomSheet open={open} onClose={() => { if (!busy) onClose() }} title="Save again">
      {!resetId ? (
        <>
          <p className="ui-row-sub">
            {agent
              ? `To start “${planName}” again, ${who.customerName} must agree. We’ll text a 6-digit code to their phone. Ask them to read it to you.`
              : `To start “${planName}” again, confirm it’s you. We’ll text a 6-digit code to the phone number on your account.`}
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
          <p className="ui-row-sub">
            {agent ? `We texted a code to ${who.customerName} (${sentTo}).` : `We texted a code to ${sentTo}.`} It works for 10 minutes.
          </p>
          <div className="ag-tf-wrap">
            <div className={`ag-tf${error ? ' is-invalid' : ''}`}>
              <label className="ag-tf-label" htmlFor="rc-code">{agent ? 'Code from the customer' : '6-digit code'}</label>
              <input id="rc-code" className="ag-tf-input ag-tf-num" type="tel" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} />
            </div>
            {error && <FieldError id="rc-code-error" message={error} />}
          </div>
          <div className="ui-stack">
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={busy || code.length !== 6} onClick={confirm}>
              {busy ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Checking…</> : 'Confirm and save again'}
            </button>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={busy} onClick={send}>Send a new code</button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}
