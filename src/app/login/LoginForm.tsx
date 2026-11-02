'use client'
import { Suspense, useState, type FormEvent } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import AuthShell from '@/components/auth/AuthShell'
import PasswordInput from '@/components/auth/PasswordInput'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { Icons } from '@/components/ui/icons'
import { describeFailure, NETWORK_MESSAGE, postJson } from '@/lib/http'
import { FINGERPRINT_FAILED, loginFailure, type AgentCheck } from '@/lib/login-failure'

export default function LoginForm() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  )
}

function LoginPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [fieldErrors, setFieldErrors] = useState({ identifier: '', password: '' })

  useEffect(() => {
    const err = searchParams.get('error')
    if (err) setError('Sign in failed. Check your details — or your account may be locked.')
    else if (searchParams.get('ended')) setNotice('You’ve been signed out. Sign in again to continue.')
  }, [searchParams])

  const [canBio, setCanBio] = useState(false)

  useEffect(() => {
    const w = window as unknown as {
      __vochusCanBiometric?: boolean
      __vochusBiometricEnrolled?: boolean
      __vochusApp?: string
      __vochusDeviceId?: string
      __vochusPerformBiometricSignin?: (creds: { identifier: string; token: string }) => void
    }
    const refresh = () => setCanBio(!!(w.__vochusCanBiometric && w.__vochusBiometricEnrolled))
    refresh()
    // Flutter injects flags in onPageFinished which may race with React hydration —
    // retry after short delays to catch late injection on subsequent page visits
    const t1 = setTimeout(refresh, 300)
    const t2 = setTimeout(refresh, 1000)
    window.addEventListener('vochus:flags-ready', refresh)
    w.__vochusPerformBiometricSignin = async (creds) => {
      if (!creds?.identifier || !creds?.token) return
      setLoading(true)
      setError('')
      setNotice('')
      try {
        const device = (window as unknown as { __vochusDevice?: Record<string, string> }).__vochusDevice
        const r = await signIn('credentials', {
          identifier: creds.identifier,
          biometricToken: creds.token,
          app: w.__vochusApp ?? '',
          deviceId: w.__vochusDeviceId ?? '',
          device: device ? JSON.stringify(device) : '',
          redirect: false,
        })
        if (r?.ok) {
          router.push('/dashboard')
          return
        }
        // Same question as a password sign-in, so a suspended agent is told why rather than just that it failed.
        const check = await postJson<AgentCheck>('/api/auth/check-agent', { identifier: creds.identifier, app: w.__vochusApp ?? '', deviceId: w.__vochusDeviceId ?? '' })
        setError(check.ok ? loginFailure(check.data, 'fingerprint').message : FINGERPRINT_FAILED)
      } catch {
        setError(navigator.onLine === false ? NETWORK_MESSAGE : FINGERPRINT_FAILED)
      } finally {
        setLoading(false)
      }
    }
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      window.removeEventListener('vochus:flags-ready', refresh)
      w.__vochusPerformBiometricSignin = undefined
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function triggerBiometric() {
    const w = window as unknown as { VochusTriggerBiometric?: { postMessage: (s: string) => void } }
    if (w.VochusTriggerBiometric) w.VochusTriggerBiometric.postMessage('')
  }

  async function login(e?: FormEvent) {
    e?.preventDefault()
    setError('')
    setNotice('')
    const next = {
      identifier: identifier.trim() ? '' : 'Enter your agent ID or phone number.',
      password: password ? '' : 'Enter your password.',
    }
    setFieldErrors(next)
    if (next.identifier || next.password) {
      document.getElementById(next.identifier ? 'agent-identifier' : 'agent-password')?.focus()
      return
    }
    if (navigator.onLine === false) { setError(NETWORK_MESSAGE); return }
    setLoading(true)
    const w = window as unknown as { __vochusApp?: string; __vochusDeviceId?: string; __vochusDevice?: Record<string, string> }
    const app = w.__vochusApp ?? ''
    const deviceId = w.__vochusDeviceId ?? ''
    const device = w.__vochusDevice ? JSON.stringify(w.__vochusDevice) : ''
    try {
      const result = await signIn('credentials', {
        identifier: identifier.trim(),
        password,
        app,
        deviceId,
        device,
        redirect: false,
      })
      if (result?.ok) {
        router.push('/dashboard')
        return
      }
      // signIn only says "failed"; ask why so the agent gets a specific answer.
      const check = await postJson<AgentCheck>('/api/auth/check-agent', { identifier: identifier.trim(), app, deviceId })
      if (!check.ok) {
        setError(check.kind === 'http' ? 'That agent ID and password don’t match. Check them and try again.' : describeFailure(check))
        return
      }
      const failure = loginFailure(check.data, 'password')
      setError(failure.message)
      if (failure.field === 'password') setFieldErrors({ identifier: '', password: 'Wrong password.' })
      if (failure.field === 'identifier') setFieldErrors({ identifier: 'We can’t find this agent ID or phone number.', password: '' })
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

  return (
    <AuthShell
      title="Agent sign in"
      lead="Enter your agent ID or phone number."
      audience="Agent"
      footer={<span><Icons.locked size={14} aria-hidden="true" /> Secure sign-in · CBN compliant<br />© 2026 Vochus Global Services Ltd.</span>}
    >
      <form onSubmit={login} noValidate>
        <div className="ui-field">
          <label className="ui-label" htmlFor="agent-identifier">Agent ID or phone number</label>
          <input
            id="agent-identifier"
            className="ui-input"
            value={identifier}
            onChange={e => { setIdentifier(e.target.value); clearErrors('identifier') }}
            onInput={e => setIdentifier((e.target as HTMLInputElement).value)}
            aria-invalid={!!fieldErrors.identifier}
            aria-describedby={fieldErrors.identifier ? 'agent-identifier-error' : undefined}
            type="text"
            placeholder="AGT-00001 or 080XXXXXXXX"
            autoComplete="username"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <FieldError id="agent-identifier-error" message={fieldErrors.identifier} />
        </div>

        <div className="ui-field">
          <label className="ui-label" htmlFor="agent-password">Password</label>
          <PasswordInput
            id="agent-password"
            value={password}
            onChange={e => { setPassword(e.target.value); clearErrors('password') }}
            onInput={e => setPassword((e.target as HTMLInputElement).value)}
            autoComplete="current-password"
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? 'agent-password-error' : undefined}
          />
          <FieldError id="agent-password-error" message={fieldErrors.password} />
          <div className="ui-field-links">
            <button type="button" className="ui-link" onClick={() => router.push('/forgot-password')}>Forgot password?</button>
            <button type="button" className="ui-link ui-link--muted" onClick={() => router.push('/unlock')}>Account locked?</button>
          </div>
        </div>

        {notice && (
          <p className="ui-banner ui-banner--info" role="status">
            <Icons.pending size={18} aria-hidden="true" />
            <span>{notice}</span>
          </p>
        )}
        <FormError message={error} />

        <button type="submit" className="ui-btn ui-btn--primary ui-btn--block" disabled={loading} aria-busy={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        {canBio && (
          <button
            type="button"
            className="ui-btn ui-btn--secondary ui-btn--block ui-auth-alt"
            onClick={triggerBiometric}
            disabled={loading}
          >
            <Icons.fingerprint size={20} aria-hidden="true" /> Sign in with fingerprint
          </button>
        )}
      </form>
    </AuthShell>
  )
}
