'use client'

import { useState, type ReactNode } from 'react'
import { Field, Modal } from './admin-ui'
import { Icons } from '@/components/ui/icons'

function PinActionModal({ title, sub, action, busyLabel, url, body, failure, onClose, onDone }: {
  title: string
  sub: ReactNode
  action: string
  busyLabel: string
  url: string
  body: Record<string, string>
  failure: string
  onClose: () => void
  onDone: (data: { sentTo?: string; cleared?: boolean }) => void
}) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [pinError, setPinError] = useState('')
  const [error, setError] = useState('')

  async function submit() {
    if (!pin.trim()) { setPinError('Enter your approval PIN.'); return }
    setBusy(true); setPinError(''); setError('')
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, pin }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; sentTo?: string; cleared?: boolean }
      if (!res.ok) {
        const message = data.error ?? failure
        if (/pin/i.test(message)) setPinError(message); else setError(message)
        return
      }
      onDone(data)
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      icon="locked" title={title} sub={sub}
      error={error || undefined} busy={busy} onClose={onClose}
      footnote={<><Icons.audit size={14} aria-hidden="true" /> Recorded in the audit log</>}
      footer={<>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-green" onClick={submit} disabled={busy || !pin}>{busy ? busyLabel : action}</button>
      </>}
    >
      <form onSubmit={e => { e.preventDefault(); submit() }}>
        <Field id="pin-action-pin" label="Your approval PIN" error={pinError}>
          <input id="pin-action-pin" className="a-input am-pin" type="password" inputMode="numeric" maxLength={6} autoComplete="off"
            value={pin} aria-invalid={!!pinError} placeholder="••••"
            onChange={e => { setPin(e.target.value); setPinError('') }} />
        </Field>
      </form>
    </Modal>
  )
}

/** Sends a password reset code to the channel on file. For someone who can't get a code themselves. */
export function SendResetCodeModal({ actorType, id, name, onClose, onSent }: {
  actorType: 'customer' | 'agent'
  id: string
  name: string
  onClose: () => void
  onSent: (message: string) => void
}) {
  return (
    <PinActionModal
      title="Send a reset code"
      sub={<>A code goes to <strong>{name}</strong> on the email or phone already on file. You won’t see it.</>}
      action="Send code" busyLabel="Sending…" failure="The code couldn’t be sent. Try again."
      url="/api/admin/password-reset" body={{ actorType, id }}
      onClose={onClose} onDone={data => onSent(`Reset code sent to ${data.sentTo ?? name}.`)}
    />
  )
}

/** Clears the lock from too many wrong passwords. Separate from the Locked status an admin sets. */
export function ClearSignInLockModal({ id, name, onClose, onDone }: {
  id: string
  name: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  return (
    <PinActionModal
      title="Clear sign-in lock"
      sub={<><strong>{name}</strong> can try their password again. Their password doesn’t change.</>}
      action="Clear lock" busyLabel="Clearing…" failure="The lock couldn’t be cleared. Try again."
      url={`/api/admin/customers/${id}/login-unlock`} body={{}}
      onClose={onClose} onDone={data => onDone(data.cleared ? `Sign-in lock cleared for ${name}.` : `${name} isn’t locked out of sign-in.`)}
    />
  )
}
