'use client'

import { useState } from 'react'
import { Field, Modal } from './admin-ui'
import { Icons } from '@/components/ui/icons'

/** Sends a password reset code to the channel on file. For someone who can't get a code themselves. */
export function SendResetCodeModal({ actorType, id, name, onClose, onSent }: {
  actorType: 'customer' | 'agent'
  id: string
  name: string
  onClose: () => void
  onSent: (message: string) => void
}) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [pinError, setPinError] = useState('')
  const [error, setError] = useState('')

  async function send() {
    if (!pin.trim()) { setPinError('Enter your approval PIN.'); return }
    setBusy(true); setPinError(''); setError('')
    try {
      const res = await fetch('/api/admin/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorType, id, pin }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; sentTo?: string }
      if (!res.ok) {
        const message = data.error ?? 'The code couldn’t be sent. Try again.'
        if (/pin/i.test(message)) setPinError(message); else setError(message)
        return
      }
      onSent(`Reset code sent to ${data.sentTo ?? name}.`)
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      icon="locked" title="Send a reset code"
      sub={<>A code goes to <strong>{name}</strong> on the email or phone already on file. You won’t see it.</>}
      error={error || undefined} busy={busy} onClose={onClose}
      footnote={<><Icons.audit size={14} aria-hidden="true" /> Recorded in the audit log</>}
      footer={<>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-green" onClick={send} disabled={busy || !pin}>{busy ? 'Sending…' : 'Send code'}</button>
      </>}
    >
      <form onSubmit={e => { e.preventDefault(); send() }}>
        <Field id="reset-code-pin" label="Your approval PIN" error={pinError}>
          <input id="reset-code-pin" className="a-input am-pin" type="password" inputMode="numeric" maxLength={6} autoComplete="off"
            value={pin} aria-invalid={!!pinError} placeholder="••••"
            onChange={e => { setPin(e.target.value); setPinError('') }} />
        </Field>
      </form>
    </Modal>
  )
}
