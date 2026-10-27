'use client'

import { useState, useEffect } from 'react'
import AuthShell from '@/components/auth/AuthShell'
import PasswordInput from '@/components/auth/PasswordInput'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { Icons } from '@/components/ui/icons'
import { describeFailure, postJson } from '@/lib/http'

export default function SuperAdminLogin() {
  useEffect(() => { fetch('/api/admin-auth/logout', { method: 'POST' }) }, [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const trimmed = email.trim()
    const next = {
      email: !trimmed ? 'Enter your email address.' : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? '' : 'Enter a valid email, like name@vochus.ng.',
      password: password ? '' : 'Enter your password.',
    }
    setFieldErrors(next)
    if (next.email || next.password) {
      document.getElementById(next.email ? 'admin-email' : 'admin-password')?.focus()
      return
    }
    setLoading(true)
    const result = await postJson('/api/admin-auth/login', { email: trimmed.toLowerCase(), password })
    if (result.ok) { window.location.href = '/superadmin'; return }
    setLoading(false)
    if (result.status === 401) setFieldErrors({ email: ' ', password: ' ' })
    setError(describeFailure(result, { 401: 'That email and password don’t match. Check them and try again.' }))
  }

  return (
    <AuthShell
      title="Admin sign in"
      lead="For Vochus staff only."
      audience="Admin"
      footer={<><Icons.locked size={14} aria-hidden="true" /> Sign-ins are recorded.</>}
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="ui-field">
          <label className="ui-label" htmlFor="admin-email">Email address</label>
          <input
            id="admin-email"
            className="ui-input"
            type="email"
            inputMode="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setFieldErrors(f => ({ ...f, email: '' })); setError('') }}
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email.trim() ? 'admin-email-error' : undefined}
            placeholder="admin@vochus.ng"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
          />
          <FieldError id="admin-email-error" message={fieldErrors.email.trim()} />
        </div>
        <div className="ui-field">
          <label className="ui-label" htmlFor="admin-password">Password</label>
          <PasswordInput
            id="admin-password"
            value={password}
            onChange={e => { setPassword(e.target.value); setFieldErrors(f => ({ ...f, password: '' })); setError('') }}
            autoComplete="current-password"
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password.trim() ? 'admin-password-error' : undefined}
          />
          <FieldError id="admin-password-error" message={fieldErrors.password.trim()} />
        </div>

        <FormError message={error} />

        <button type="submit" className="ui-btn ui-btn--primary ui-btn--block" disabled={loading} aria-busy={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  )
}
