'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import AuthShell from '@/components/auth/AuthShell'
import PasswordInput from '@/components/auth/PasswordInput'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { describeFailure, postJson } from '@/lib/http'

function AcceptInviteForm() {
  const token = useSearchParams().get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const next = password.length < 8 ? 'Use at least 8 characters.' : password !== confirm ? 'The two passwords don’t match.' : ''
    setFieldError(next)
    if (next) return
    setLoading(true)
    const result = await postJson('/api/admin-auth/accept-invite', { token, newPassword: password })
    setLoading(false)
    if (result.ok) { setDone(true); return }
    setError(describeFailure(result, { 400: 'This link is invalid or has expired. Ask your administrator to send a new invite.' }))
  }

  if (!token) {
    return (
      <AuthShell title="Invite link needed" lead="Open the link from your invite email, or ask your administrator to send a new one." audience="Admin">
        <a className="ui-btn ui-btn--primary ui-btn--block" href="/superadmin/login">Go to sign in</a>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell title="Password set" lead="Your account is ready. Sign in with your email and the password you just chose." audience="Admin">
        <a className="ui-btn ui-btn--primary ui-btn--block" href="/superadmin/login">Go to sign in</a>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Set your password" lead="Choose a password to finish setting up your Vochus admin account." audience="Admin">
      <form onSubmit={handleSubmit} noValidate>
        <div className="ui-field">
          <label className="ui-label" htmlFor="invite-password">New password</label>
          <PasswordInput
            id="invite-password"
            value={password}
            onChange={e => { setPassword(e.target.value); setFieldError(''); setError('') }}
            autoComplete="new-password"
            aria-invalid={!!fieldError}
            aria-describedby={fieldError ? 'invite-password-error' : undefined}
          />
        </div>
        <div className="ui-field">
          <label className="ui-label" htmlFor="invite-confirm">Confirm password</label>
          <PasswordInput
            id="invite-confirm"
            value={confirm}
            onChange={e => { setConfirm(e.target.value); setFieldError(''); setError('') }}
            autoComplete="new-password"
          />
          <FieldError id="invite-password-error" message={fieldError} />
        </div>
        <FormError message={error} />
        <button type="submit" className="ui-btn ui-btn--primary ui-btn--block" disabled={loading} aria-busy={loading}>
          {loading ? 'Saving…' : 'Set password'}
        </button>
      </form>
    </AuthShell>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  )
}
