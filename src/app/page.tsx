'use client'

import { useState, useEffect, useRef } from 'react'
import { signIn, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import AuthShell from '@/components/auth/AuthShell'
import PasswordInput from '@/components/auth/PasswordInput'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { Icons } from '@/components/ui/icons'
import { NETWORK_MESSAGE } from '@/lib/http'

export default function LoginPage() {
  const router = useRouter()

  useEffect(() => { signOut({ redirect: false }) }, [])
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const identifierRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({ identifier: '', password: '' })
  const [locked, setLocked] = useState(false)
  const [lockedMinutes, setLockedMinutes] = useState(0)
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    // Read the DOM values too: browser autofill doesn't always fire onChange.
    const actualIdentifier = identifierRef.current?.value ?? identifier
    const actualPassword = passwordRef.current?.value ?? password
    setError('')
    const next = {
      identifier: actualIdentifier.trim().length >= 4 ? '' : actualIdentifier.trim() ? 'Agent IDs and phone numbers are at least 4 characters.' : 'Enter your agent ID or phone number.',
      password: actualPassword.length >= 4 ? '' : actualPassword ? 'Your password or PIN is at least 4 characters.' : 'Enter your password or PIN.',
    }
    setFieldErrors(next)
    if (next.identifier || next.password) {
      (next.identifier ? identifierRef : passwordRef).current?.focus()
      return
    }
    if (navigator.onLine === false) { setError(NETWORK_MESSAGE); return }
    setLoading(true)
    setLocked(false)
    try {
      const res = await signIn('credentials', {
        identifier: actualIdentifier.trim(),
        password: actualPassword,
        redirect: false,
      })
      if (res?.ok) {
        router.push('/dashboard')
        return
      }
      const status = await fetch(`/api/agent/login-status?identifier=${encodeURIComponent(actualIdentifier.trim())}`)
        .then(r => r.json())
        .catch(() => ({ locked: false, attemptsLeft: 3 }))
      if (status.locked) {
        setLocked(true)
        setLockedMinutes(status.lockedMinutesRemaining ?? 30)
      } else if (status.attemptsLeft <= 2) {
        setFieldErrors({ identifier: '', password: 'Wrong password or PIN.' })
        setError(`Wrong password or PIN. ${status.attemptsLeft} ${status.attemptsLeft === 1 ? 'try' : 'tries'} left before your account is locked.`)
      } else {
        setFieldErrors({ identifier: ' ', password: ' ' })
        setError('That agent ID and password don’t match. Check them and try again.')
      }
    } catch {
      setError(NETWORK_MESSAGE)
    } finally {
      setLoading(false)
    }
  }

  function clearErrors(field: 'identifier' | 'password') {
    setFieldErrors(f => ({ ...f, [field]: '' }))
    setError('')
  }

  if (locked) return (
    <AuthShell title="Account locked" audience="Agent" footer={FOOTER}>
      <div className="ui-banner ui-banner--warn" role="alert">
        <Icons.locked size={18} aria-hidden="true" />
        <div>
          Your account was locked after 3 failed sign-in attempts.
          {lockedMinutes > 0 && <> It unlocks by itself in <strong>{lockedMinutes} min</strong>, or reset your password to unlock it now.</>}
        </div>
      </div>
      <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => router.push('/forgot-password')}>
        Reset password and unlock
      </button>
      <button
        type="button"
        className="ui-btn ui-btn--secondary ui-btn--block ui-auth-alt"
        onClick={() => { setLocked(false); setError('') }}
      >
        Try my password again
      </button>
    </AuthShell>
  )

  return (
    <AuthShell title="Agent sign in" lead="Enter your agent ID or phone number." audience="Agent" footer={FOOTER}>
      <form onSubmit={handleLogin} noValidate>
        <div className="ui-field">
          <label className="ui-label" htmlFor="root-identifier">Agent ID or phone number</label>
          <input
            id="root-identifier"
            className="ui-input"
            type="text"
            placeholder="AGT-00142 or 080XXXXXXXX"
            value={identifier}
            ref={identifierRef}
            onChange={e => { setIdentifier(e.target.value); clearErrors('identifier') }}
            onInput={e => setIdentifier((e.target as HTMLInputElement).value)}
            aria-invalid={!!fieldErrors.identifier}
            aria-describedby={fieldErrors.identifier.trim() ? 'root-identifier-error' : undefined}
            autoComplete="username"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <FieldError id="root-identifier-error" message={fieldErrors.identifier.trim()} />
        </div>

        <div className="ui-field">
          <label className="ui-label" htmlFor="root-password">Password or PIN</label>
          <PasswordInput
            id="root-password"
            inputRef={passwordRef}
            value={password}
            onChange={e => { setPassword(e.target.value); clearErrors('password') }}
            onInput={e => setPassword((e.target as HTMLInputElement).value)}
            autoComplete="current-password"
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password.trim() ? 'root-password-error' : undefined}
          />
          <FieldError id="root-password-error" message={fieldErrors.password.trim()} />
          <div className="ui-field-links">
            <button type="button" className="ui-link" onClick={() => router.push('/forgot-password')}>Forgot password?</button>
            <button type="button" className="ui-link ui-link--muted" onClick={() => router.push('/unlock')}>Account locked?</button>
          </div>
        </div>

        <FormError message={error} />

        <button type="submit" className="ui-btn ui-btn--primary ui-btn--block" disabled={loading} aria-busy={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  )
}

const FOOTER = (
  <span>
    Need access? Contact your supervisor.
    <br />© 2026 Vochus Global Services Ltd.
  </span>
)
