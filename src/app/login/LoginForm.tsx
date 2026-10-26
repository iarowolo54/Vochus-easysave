'use client'
import { Suspense, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import Logo from '@/components/Logo'

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
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const err = searchParams.get('error')
    if (err) setError('Invalid credentials or account locked')
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
      const device = (window as unknown as { __vochusDevice?: Record<string, string> }).__vochusDevice
      const r = await signIn('credentials', {
        identifier: creds.identifier,
        biometricToken: creds.token,
        app: w.__vochusApp ?? '',
        deviceId: w.__vochusDeviceId ?? '',
        device: device ? JSON.stringify(device) : '',
        redirect: false,
      })
      setLoading(false)
      if (r?.ok) router.push('/dashboard')
      else setError('Biometric sign-in failed — please log in with your password')
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
    if (!identifier || !password) {
      setError('Enter agent ID/phone and password')
      return
    }
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
      } else {
        try {
          const checkRes = await fetch('/api/auth/check-agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: identifier.trim(), app, deviceId }),
          })
          const checkData = await checkRes.json()
          if (checkData.locked) {
            setError(`Account locked after too many failed attempts. Try again in ${checkData.lockedMinutesRemaining} min, or tap "Forgot password?" below to reset now.`)
          } else if (checkData.deviceMismatch) {
            setError('This account is locked to another mobile device. Contact your administrator to reset device binding.')
          } else if (checkData.unverifiedEmail) {
            setError('Your email is not verified yet. Check your inbox (and spam) for the verification link, or contact your administrator.')
          } else if (checkData.exists && checkData.status !== 'Active') {
            setError('Your account is pending activation. Please contact your administrator.')
          } else if (checkData.exists) {
            setError('Incorrect password. If you forgot it, tap "Forgot password?" below to reset.')
          } else {
            setError('No account found with that Agent ID or phone number. Check spelling or contact your administrator.')
          }
        } catch {
          setError('Incorrect ID or password. Please try again.')
        }
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#051810 0%,#0A3520 50%,#0C4824 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', paddingTop: '60px', paddingBottom: '40px' }}>
      <style>{`@media (max-width: 480px) { body { font-size: 14px; } }`}</style>
      <div style={{ width: '100%', maxWidth: 420, minWidth: 0 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Logo size={56} tile style={{ marginBottom: 12 }} />
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 'clamp(20px, 5vw, 26px)', fontWeight: 900, color: '#fff', letterSpacing: -.5 }}>Vochus Easy Save</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 4 }}>Agent Portal</div>
        </div>

        <div style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)', borderRadius: '16px', padding: '20px', boxShadow: '0 25px 50px rgba(0,0,0,.2)', backdropFilter: 'blur(10px)' }}>
          {error && (
            <div style={{ background: 'rgba(220,50,50,.15)', color: '#ff6b6b', border: '1px solid rgba(192,57,43,.3)', borderRadius: 12, padding: '12px 16px', fontSize: 13, marginBottom: 18, fontWeight: 500 }}>
              ⚠️ {error}
            </div>
          )}

          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: .5, marginBottom: 8, textTransform: 'uppercase' }}>Agent ID or Phone</label>
          <input
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && login()}
            type="text"
            placeholder="AGT-00001 or 08023404253"
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '13px 16px', marginBottom: 18,
              fontSize: 15, fontWeight: 600,
              background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)',
              borderRadius: 12, color: '#fff', outline: 'none',
              fontFamily: 'inherit',
            }}
            onFocus={e => e.target.style.borderColor = 'rgba(29,201,106,.4)'}
            onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,.15)'}
          />

          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: .5, marginBottom: 8, textTransform: 'uppercase' }}>Password</label>
          <div style={{ position: 'relative', marginBottom: 24 }}>
            <input
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && login()}
              type={showPass ? 'text' : 'password'}
              placeholder="Your password"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '13px 48px 13px 16px',
                fontSize: 15, fontWeight: 600,
                background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)',
                borderRadius: 12, color: '#fff', outline: 'none',
                fontFamily: 'inherit',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(29,201,106,.4)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,.15)'}
            />
            <button
              type="button"
              onClick={() => setShowPass(p => !p)}
              style={{
                position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, opacity: 0.7,
              }}
            >
              {showPass ? '🙈' : '👁'}
            </button>
          </div>

          <div style={{ textAlign: 'right', marginTop: -6, marginBottom: 14 }}>
            <span
              onClick={() => router.push('/forgot-password')}
              style={{ fontSize: 12.5, color: '#1DC96A', fontWeight: 700, cursor: 'pointer' }}
            >
              Forgot password?
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <button
              onClick={login}
              disabled={loading}
              style={{
                flex: 1, padding: '14px 20px',
                background: loading ? 'rgba(29,201,106,.5)' : 'linear-gradient(135deg,#0D6B3A,#1DC96A)',
                border: 'none', borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff',
                boxShadow: '0 8px 24px rgba(29,201,106,.3)', opacity: loading ? 0.7 : 1,
                transition: 'all .2s ease',
              }}
            >
              {loading ? '🔐 Signing in…' : '🔑 Sign In'}
            </button>
            {canBio && (
              <button
                onClick={triggerBiometric}
                disabled={loading}
                title="Sign in with biometrics"
                aria-label="Sign in with biometrics"
                style={{
                  width: 52, padding: 0,
                  background: 'rgba(29,201,106,.12)', border: '1px solid rgba(29,201,106,.4)',
                  borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#1DC96A',
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
                  <path d="M17.81 4.47c-.08 0-.16-.02-.23-.06C15.66 3.42 14 3 12.01 3c-1.98 0-3.86.47-5.57 1.41-.24.13-.54.04-.68-.2-.13-.24-.04-.55.2-.68C7.82 2.52 9.86 2 12.01 2c2.13 0 3.99.47 6.03 1.52.25.13.34.43.21.67-.09.18-.26.28-.44.28zM3.5 9.72c-.1 0-.2-.03-.29-.09-.23-.16-.28-.47-.12-.7.99-1.4 2.25-2.5 3.75-3.27C9.98 4.04 14 4.03 17.15 5.65c1.5.77 2.76 1.86 3.75 3.25.16.22.11.54-.12.7-.23.16-.54.11-.7-.12-.9-1.26-2.04-2.25-3.39-2.94-2.87-1.47-6.54-1.47-9.4.01-1.36.7-2.5 1.7-3.4 2.96-.08.14-.24.21-.39.21zm6.25 12.07c-.13 0-.26-.05-.35-.15-.87-.87-1.34-1.43-2.01-2.64-.69-1.23-1.05-2.73-1.05-4.34 0-2.97 2.54-5.39 5.66-5.39s5.66 2.42 5.66 5.39c0 .28-.22.5-.5.5s-.5-.22-.5-.5c0-2.42-2.09-4.39-4.66-4.39s-4.66 1.97-4.66 4.39c0 1.44.32 2.77.93 3.85.64 1.15 1.08 1.64 1.85 2.42.19.2.19.51 0 .71-.11.1-.24.15-.37.15zm7.17-1.85c-1.19 0-2.24-.3-3.1-.89-1.49-1.01-2.38-2.65-2.38-4.39 0-.28.22-.5.5-.5s.5.22.5.5c0 1.41.72 2.74 1.94 3.56.71.48 1.54.71 2.54.71.24 0 .64-.03 1.04-.1.27-.05.53.13.58.41.05.27-.13.53-.41.58-.57.11-1.07.12-1.21.12zM14.91 22c-.04 0-.09-.01-.13-.02-1.59-.44-2.63-1.03-3.72-2.1-1.4-1.39-2.17-3.24-2.17-5.22 0-1.62 1.38-2.94 3.08-2.94s3.08 1.32 3.08 2.94c0 1.07.93 1.94 2.08 1.94s2.08-.87 2.08-1.94c0-3.77-3.25-6.83-7.25-6.83-2.84 0-5.44 1.58-6.61 4.03-.39.81-.59 1.76-.59 2.8 0 .78.07 2.01.67 3.61.1.26-.03.55-.29.64-.26.1-.55-.04-.64-.29-.49-1.31-.73-2.61-.73-3.96 0-1.2.23-2.29.68-3.24 1.33-2.79 4.28-4.6 7.51-4.6 4.55 0 8.25 3.51 8.25 7.83 0 1.62-1.38 2.94-3.08 2.94s-3.08-1.32-3.08-2.94c0-1.07-.93-1.94-2.08-1.94s-2.08.87-2.08 1.94c0 1.71.66 3.31 1.87 4.51.95.94 1.86 1.46 3.27 1.85.27.07.42.35.35.61-.05.23-.26.38-.47.38z"/>
                </svg>
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button
              onClick={() => {}}
              style={{
                padding: '11px 14px',
                background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)',
                borderRadius: 10, cursor: 'pointer',
                fontFamily: 'Plus Jakarta Sans', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.7)',
              }}
            >
              📞 Support
            </button>
            <button
              onClick={() => {}}
              style={{
                padding: '11px 14px',
                background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)',
                borderRadius: 10, cursor: 'pointer',
                fontFamily: 'Plus Jakarta Sans', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.7)',
              }}
            >
              ❓ Help
            </button>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', lineHeight: 1.6 }}>
            🔒 Secure login · 🇳🇬 CBN Compliant<br />
            Vochus Financial Services © 2025
          </div>
        </div>
      </div>
    </div>
  )
}
