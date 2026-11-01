'use client'

import { useState } from 'react'
import { Field, Modal } from './admin-ui'

const MIN_PASSWORD = 8

async function post(url: string, body: object): Promise<string | null> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (r.ok) return null
    const d: unknown = await r.json().catch(() => null)
    const msg = typeof d === 'object' && d !== null ? (d as { error?: unknown }).error : null
    return typeof msg === 'string' ? msg : 'That didn’t go through. Try again.'
  } catch {
    return 'Check your connection and try again.'
  }
}

export function ChangePasswordModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErr, setFieldErr] = useState<{ current?: string; next?: string; confirm?: string }>({})

  async function submit() {
    const e: typeof fieldErr = {}
    if (!current) e.current = 'Enter your current password'
    if (next.length < MIN_PASSWORD) e.next = `Use at least ${MIN_PASSWORD} characters`
    if (confirm !== next) e.confirm = 'The two passwords don’t match'
    setFieldErr(e)
    if (Object.keys(e).length) return
    setBusy(true); setError('')
    const err = await post('/api/admin/me/password', { currentPassword: current, newPassword: next })
    setBusy(false)
    if (err) setError(err); else onDone()
  }

  return (
    <Modal icon="settings" title="Change password" busy={busy} error={error || undefined} onClose={() => { if (!busy) onClose() }}
      footer={<>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-green" onClick={submit} disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : 'Change password'}</button>
      </>}>
      <form onSubmit={ev => { ev.preventDefault(); submit() }} noValidate>
        <Field id="sp-cur" label="Current password" error={fieldErr.current}>
          <input id="sp-cur" className="a-input" type="password" autoComplete="current-password" value={current} aria-invalid={!!fieldErr.current} onChange={e => setCurrent(e.target.value)} />
        </Field>
        <Field id="sp-new" label="New password" hint={`At least ${MIN_PASSWORD} characters.`} error={fieldErr.next}>
          <input id="sp-new" className="a-input" type="password" autoComplete="new-password" value={next} aria-invalid={!!fieldErr.next} onChange={e => setNext(e.target.value)} />
        </Field>
        <Field id="sp-conf" label="Confirm new password" error={fieldErr.confirm}>
          <input id="sp-conf" className="a-input" type="password" autoComplete="new-password" value={confirm} aria-invalid={!!fieldErr.confirm} onChange={e => setConfirm(e.target.value)} />
        </Field>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  )
}

export function SetPinModal({ hasPin, onClose, onDone }: { hasPin: boolean; onClose: () => void; onDone: () => void }) {
  const [pin, setPin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErr, setFieldErr] = useState<{ pin?: string; password?: string }>({})

  async function submit() {
    const e: typeof fieldErr = {}
    if (!/^\d{4,}$/.test(pin)) e.pin = 'Use at least 4 digits'
    if (!password) e.password = 'Enter your password to confirm'
    setFieldErr(e)
    if (Object.keys(e).length) return
    setBusy(true); setError('')
    const err = await post('/api/admin/me/approval-pin', { pin, currentPassword: password })
    setBusy(false)
    if (err) setError(err); else onDone()
  }

  return (
    <Modal icon="locked" tone="money" title={hasPin ? 'Change approval PIN' : 'Set approval PIN'} sub="You enter this PIN to approve payouts and cash movements." busy={busy} error={error || undefined}
      onClose={() => { if (!busy) onClose() }}
      footer={<>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-green" onClick={submit} disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : 'Save PIN'}</button>
      </>}>
      <form onSubmit={ev => { ev.preventDefault(); submit() }} noValidate>
        <Field id="sp-pin" label="New PIN" hint="Digits only, at least 4." error={fieldErr.pin}>
          <input id="sp-pin" className="a-input" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={pin} aria-invalid={!!fieldErr.pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field id="sp-pw" label="Your password" error={fieldErr.password}>
          <input id="sp-pw" className="a-input" type="password" autoComplete="current-password" value={password} aria-invalid={!!fieldErr.password} onChange={e => setPassword(e.target.value)} />
        </Field>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  )
}
