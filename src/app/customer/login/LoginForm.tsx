'use client'
import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { blockNonDigit, digitsOnly } from '@/lib/numeric'
import AuthShell from '@/components/auth/AuthShell'
import PasswordInput from '@/components/auth/PasswordInput'
import { Icons } from '@/components/ui/icons'

export default function LoginForm() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
    if (!phone || !password) { setError('Enter your phone number and password.'); return }
    setLoading(true)
    const w = window as unknown as { __vochusApp?: string; __vochusDeviceId?: string; __vochusDevice?: Record<string, string> }
    try {
      const res = await fetch('/api/customer/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), password, app: w.__vochusApp ?? '', deviceId: w.__vochusDeviceId ?? '', device: w.__vochusDevice }),
      })
      const data = await res.json()
      if (res.status === 401) { setError('That phone number and password don’t match. Check them and try again.'); return }
      if (!res.ok) { setError(data.error ?? 'Sign in failed. Please try again.'); return }
      router.push('/customer/dashboard')
    } catch { setError('No connection. Check your internet and try again.') }
    finally { setLoading(false) }
  }

  return (
    <AuthShell
      title="Welcome back"
      lead="Sign in to see your savings."
      footer={<><Icons.locked size={14} aria-hidden="true" /> Your details are sent securely.</>}
    >
      <form onSubmit={login} noValidate>
        <div className="ui-field">
          <label className="ui-label" htmlFor="login-phone">Phone number</label>
          <input
            id="login-phone"
            className="ui-input ui-input--number"
            value={phone}
            onChange={e => setPhone(digitsOnly(e.target.value).slice(0, 11))}
            onKeyDown={blockNonDigit}
            type="tel"
            inputMode="numeric"
            maxLength={11}
            placeholder="080XXXXXXXX"
            autoComplete="tel"
          />
        </div>

        <div className="ui-field">
          <label className="ui-label" htmlFor="login-password">Password</label>
          <PasswordInput id="login-password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
          <button type="button" className="ui-link ui-field-link" onClick={() => router.push('/customer/forgot-password')}>
            Forgot password?
          </button>
        </div>

        {error && (
          <div className="ui-banner ui-banner--danger" role="alert">
            <Icons.error size={18} aria-hidden="true" />
            <div>{error}</div>
          </div>
        )}

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
