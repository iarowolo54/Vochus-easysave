'use client'
import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { blockNonDigit, digitsOnly } from '@/lib/numeric'
import AuthShell from '@/components/auth/AuthShell'
import PasswordInput from '@/components/auth/PasswordInput'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { Icons } from '@/components/ui/icons'
import { describeFailure, phoneError, postJson } from '@/lib/http'

export default function LoginForm() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({ phone: '', password: '' })
  const [notice, setNotice] = useState('')

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
    if (new URLSearchParams(window.location.search).get('unlocked')) {
      setNotice('Your account is unlocked. Sign in with your password.')
    }
    const t1 = setTimeout(refresh, 300)
    const t2 = setTimeout(refresh, 1000)
    window.addEventListener('vochus:flags-ready', refresh)
    w.__vochusPerformBiometricSignin = async (creds) => {
      if (!creds?.identifier || !creds?.token) return
      setLoading(true)
      try {
        const res = await fetch('/api/customer/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: creds.identifier,
            biometricToken: creds.token,
            app: w.__vochusApp ?? '',
            deviceId: w.__vochusDeviceId ?? '',
            device: (w as unknown as { __vochusDevice?: Record<string, string> }).__vochusDevice,
          }),
        })
        if (res.ok) { router.push('/customer/dashboard'); return }
        // A hard-locked account (4 wrong passwords) can only be reopened with a one-time code.
        if (res.status === 423) { router.push(`/customer/unlock?phone=${encodeURIComponent(creds.identifier)}`); return }
        setError('Fingerprint sign-in didn’t work. Please sign in with your password.')
      } catch {
        setError('Fingerprint sign-in didn’t work. Please sign in with your password.')
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
    const next = { phone: phoneError(phone), password: password ? '' : 'Enter your password.' }
    setFieldErrors(next)
    if (next.phone || next.password) {
      document.getElementById(next.phone ? 'login-phone' : 'login-password')?.focus()
      return
    }
    setLoading(true)
    const w = window as unknown as { __vochusApp?: string; __vochusDeviceId?: string; __vochusDevice?: Record<string, string> }
    const result = await postJson('/api/customer/auth/login', {
      phone: phone.trim(), password, app: w.__vochusApp ?? '', deviceId: w.__vochusDeviceId ?? '', device: w.__vochusDevice,
    })
    setLoading(false)
    if (result.ok) { router.push('/customer/dashboard'); return }
    // A hard-locked account (4 wrong passwords) can only be reopened with a one-time code.
    if (result.status === 423) { router.push(`/customer/unlock?phone=${encodeURIComponent(phone.trim())}`); return }
    if (result.status === 401) setFieldErrors({ phone: ' ', password: ' ' }) // mark both; the banner explains
    setError(describeFailure(result, {
      401: 'That phone number and password don’t match. Check them and try again, or reset your password.',
    }))
  }

  function editPhone(value: string) {
    setPhone(digitsOnly(value).slice(0, 11))
    setFieldErrors(f => ({ ...f, phone: '' }))
    setError('')
  }

  function editPassword(value: string) {
    setPassword(value)
    setFieldErrors(f => ({ ...f, password: '' }))
    setError('')
  }

  return (
    <AuthShell
      title="Welcome back"
      lead="Sign in to see your savings."
      footer={<><Icons.locked size={14} aria-hidden="true" /> Your details are sent securely.</>}
    >
      <form onSubmit={login} noValidate>
        {notice && !error && (
          <div className="ui-banner ui-banner--info" role="status">
            <Icons.check size={18} aria-hidden="true" />
            <div>{notice}</div>
          </div>
        )}
        <div className="ui-field">
          <label className="ui-label" htmlFor="login-phone">Phone number</label>
          <input
            id="login-phone"
            className="ui-input ui-input--number"
            value={phone}
            onChange={e => editPhone(e.target.value)}
            aria-invalid={!!fieldErrors.phone}
            aria-describedby={fieldErrors.phone.trim() ? 'login-phone-error' : undefined}
            onKeyDown={blockNonDigit}
            type="tel"
            inputMode="numeric"
            maxLength={11}
            placeholder="080XXXXXXXX"
            autoComplete="tel"
          />
          <FieldError id="login-phone-error" message={fieldErrors.phone.trim()} />
        </div>

        <div className="ui-field">
          <label className="ui-label" htmlFor="login-password">Password</label>
          <PasswordInput
            id="login-password"
            value={password}
            onChange={e => editPassword(e.target.value)}
            autoComplete="current-password"
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password.trim() ? 'login-password-error' : undefined}
          />
          <FieldError id="login-password-error" message={fieldErrors.password.trim()} />
          <button type="button" className="ui-link ui-field-link" onClick={() => router.push('/customer/forgot-password')}>
            Forgot password?
          </button>
        </div>

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
