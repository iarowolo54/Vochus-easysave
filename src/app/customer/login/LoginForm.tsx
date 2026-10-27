'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { blockNonDigit, digitsOnly } from '@/lib/numeric'

export default function LoginForm() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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
      setNotice('Account unlocked — please sign in.')
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
        if (res.status === 423) { router.push(`/customer/unlock?phone=${encodeURIComponent(creds.identifier)}`); return }
        setError('Biometric sign-in failed — please log in with your password')
      } catch {
        setError('Biometric sign-in failed — please log in with your password')
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

  async function login() {
    setError('')
    if (!phone || !password) { setError('Enter phone and password'); return }
    setLoading(true)
    const w = window as unknown as { __vochusApp?: string; __vochusDeviceId?: string; __vochusDevice?: Record<string, string> }
    try {
      const res = await fetch('/api/customer/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), password, app: w.__vochusApp ?? '', deviceId: w.__vochusDeviceId ?? '', device: w.__vochusDevice }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 423) { router.push(`/customer/unlock?phone=${encodeURIComponent(phone.trim())}`); return }
        setError(data.error ?? 'Login failed'); return
      }
      router.push('/customer/dashboard')
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'Plus Jakarta Sans', fontSize: 24, fontWeight: 900, color: '#fff', marginBottom: 12,
          }}>V</div>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 22, fontWeight: 900, color: 'var(--txt)' }}>Vochus Easy Save</div>
          <div style={{ fontSize: 13, color: 'var(--mu)', marginTop: 4 }}>Customer Portal Login</div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
          {notice && !error && (
            <div style={{ background: 'var(--gl)', color: 'var(--g)', border: '1px solid rgba(46,204,113,.25)', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
              {notice}
            </div>
          )}
          {error && (
            <div style={{ background: 'var(--rdl)', color: 'var(--rd)', border: '1px solid rgba(192,57,43,.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
              {error}
            </div>
          )}
          <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--mu)', letterSpacing: .3, marginBottom: 6 }}>Phone Number</label>
          <input
            value={phone} onChange={e => setPhone(digitsOnly(e.target.value).slice(0, 11))}
            type="tel" inputMode="numeric" maxLength={11} placeholder="080XXXXXXXX"
            style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1 }}
            onKeyDown={e => { if (e.key === 'Enter') { login(); return } blockNonDigit(e) }}
            autoComplete="tel"
          />
          <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--mu)', letterSpacing: .3, marginBottom: 6 }}>Password</label>
          <div style={{ position: 'relative' }}>
            <input
              value={password} onChange={e => setPassword(e.target.value)}
              type={showPass ? 'text' : 'password'} placeholder="Your password"
              style={{ paddingRight: 44 }}
              onKeyDown={e => e.key === 'Enter' && login()}
              autoComplete="current-password"
            />
            <button type="button" onClick={() => setShowPass(p => !p)} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-72%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>
              {showPass ? '🙈' : '👁'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={login} disabled={loading}
              style={{
                flex: 1, padding: 15, background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)',
                border: 'none', borderRadius: 13, cursor: 'pointer',
                fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff',
                boxShadow: '0 6px 20px rgba(26,107,58,.35)', opacity: loading ? .6 : 1,
              }}
            >{loading ? 'Signing in…' : 'Sign In'}</button>
            {canBio && (
              <button
                onClick={triggerBiometric}
                disabled={loading}
                title="Sign in with biometrics"
                aria-label="Sign in with biometrics"
                style={{
                  width: 56, padding: 0, background: 'var(--gl)', border: '1.5px solid var(--g)',
                  borderRadius: 13, cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--g)',
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
                  <path d="M17.81 4.47c-.08 0-.16-.02-.23-.06C15.66 3.42 14 3 12.01 3c-1.98 0-3.86.47-5.57 1.41-.24.13-.54.04-.68-.2-.13-.24-.04-.55.2-.68C7.82 2.52 9.86 2 12.01 2c2.13 0 3.99.47 6.03 1.52.25.13.34.43.21.67-.09.18-.26.28-.44.28zM3.5 9.72c-.1 0-.2-.03-.29-.09-.23-.16-.28-.47-.12-.7.99-1.4 2.25-2.5 3.75-3.27C9.98 4.04 14 4.03 17.15 5.65c1.5.77 2.76 1.86 3.75 3.25.16.22.11.54-.12.7-.23.16-.54.11-.7-.12-.9-1.26-2.04-2.25-3.39-2.94-2.87-1.47-6.54-1.47-9.4.01-1.36.7-2.5 1.7-3.4 2.96-.08.14-.24.21-.39.21zm6.25 12.07c-.13 0-.26-.05-.35-.15-.87-.87-1.34-1.43-2.01-2.64-.69-1.23-1.05-2.73-1.05-4.34 0-2.97 2.54-5.39 5.66-5.39s5.66 2.42 5.66 5.39c0 .28-.22.5-.5.5s-.5-.22-.5-.5c0-2.42-2.09-4.39-4.66-4.39s-4.66 1.97-4.66 4.39c0 1.44.32 2.77.93 3.85.64 1.15 1.08 1.64 1.85 2.42.19.2.19.51 0 .71-.11.1-.24.15-.37.15zm7.17-1.85c-1.19 0-2.24-.3-3.1-.89-1.49-1.01-2.38-2.65-2.38-4.39 0-.28.22-.5.5-.5s.5.22.5.5c0 1.41.72 2.74 1.94 3.56.71.48 1.54.71 2.54.71.24 0 .64-.03 1.04-.1.27-.05.53.13.58.41.05.27-.13.53-.41.58-.57.11-1.07.12-1.21.12zM14.91 22c-.04 0-.09-.01-.13-.02-1.59-.44-2.63-1.03-3.72-2.1-1.4-1.39-2.17-3.24-2.17-5.22 0-1.62 1.38-2.94 3.08-2.94s3.08 1.32 3.08 2.94c0 1.07.93 1.94 2.08 1.94s2.08-.87 2.08-1.94c0-3.77-3.25-6.83-7.25-6.83-2.84 0-5.44 1.58-6.61 4.03-.39.81-.59 1.76-.59 2.8 0 .78.07 2.01.67 3.61.1.26-.03.55-.29.64-.26.1-.55-.04-.64-.29-.49-1.31-.73-2.61-.73-3.96 0-1.2.23-2.29.68-3.24 1.33-2.79 4.28-4.6 7.51-4.6 4.55 0 8.25 3.51 8.25 7.83 0 1.62-1.38 2.94-3.08 2.94s-3.08-1.32-3.08-2.94c0-1.07-.93-1.94-2.08-1.94s-2.08.87-2.08 1.94c0 1.71.66 3.31 1.87 4.51.95.94 1.86 1.46 3.27 1.85.27.07.42.35.35.61-.05.23-.26.38-.47.38z"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--mu)' }}>
          <span style={{ color: 'var(--g)', fontWeight: 700, cursor: 'pointer' }} onClick={() => router.push('/customer/forgot-password')}>
            Forgot password?
          </span>
        </div>
      </div>
    </div>
  )
}
