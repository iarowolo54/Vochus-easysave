'use client'

import { useState, useEffect, useRef } from 'react'
import { signIn, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Logo from '@/components/Logo'

export default function LoginPage() {
  const router = useRouter()

  useEffect(() => { signOut({ redirect: false }) }, [])
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const identifierRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)
  const [lockedMinutes, setLockedMinutes] = useState(0)
  const [loading, setLoading] = useState(false)

  const canSubmit = identifier.trim().length >= 4 && password.length >= 4

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    const actualIdentifier = identifierRef.current?.value ?? identifier
    const actualPassword = passwordRef.current?.value ?? password
    if (actualIdentifier.trim().length < 4 || actualPassword.length < 4) return
    setLoading(true)
    setError('')
    setLocked(false)
    const res = await signIn('credentials', {
      identifier: actualIdentifier.trim(),
      password: actualPassword,
      redirect: false,
    })
    setLoading(false)
    if (res?.ok) {
      router.push('/dashboard')
    } else {
      const status = await fetch(`/api/agent/login-status?identifier=${encodeURIComponent(identifier.trim())}`).then(r => r.json()).catch(() => ({ locked: false, attemptsLeft: 3 }))
      if (status.locked) {
        setLocked(true)
        setLockedMinutes(status.lockedMinutesRemaining ?? 30)
        setError('')
      } else if (status.attemptsLeft <= 2) {
        setError(`⚠️ Incorrect PIN. ${status.attemptsLeft} attempt${status.attemptsLeft === 1 ? '' : 's'} remaining before your account is locked.`)
      } else {
        setError('⚠️ Incorrect ID or password. Please try again.')
      }
    }
  }

  return (
    <div className="login-page">
      <div className="login-wrap">
        <Logo size={72} tile />
        <div className="login-brand">
          <h1>Vochus Easy Save</h1>
          <p>Agent Portal &nbsp;·&nbsp; v2.1</p>
        </div>

        {locked ? (
          <div className="login-card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
            <h2 style={{ marginBottom: 8 }}>Account Locked</h2>
            <p style={{ color: 'var(--text3)', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
              Your account has been locked after 3 failed sign-in attempts.<br />
              {lockedMinutes > 0 && <>It will auto-unlock in <strong>{lockedMinutes} min</strong>, or you can reset your password to unlock immediately.</>}
            </p>
            <button
              className="lbtn"
              onClick={() => router.push('/forgot-password')}
              style={{ marginBottom: 10 }}
            >
              Reset Password & Unlock →
            </button>
            <button
              type="button"
              onClick={() => { setLocked(false); setError('') }}
              style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: 4 }}
            >
              Try password again
            </button>
          </div>
        ) : (
          <form className="login-card" onSubmit={handleLogin}>
            <h2>Sign In to Your Account</h2>
            <p>Enter your agent credentials to access the portal.</p>

            {error && <div className="lerr">{error}</div>}

            <label className="lbl">Agent ID / Phone Number</label>
            <input
              className="linput"
              type="text"
              placeholder="e.g. AGT-00142 or 0801 234 5678"
              value={identifier}
              ref={identifierRef}
              onChange={e => setIdentifier(e.target.value)}
              onInput={e => setIdentifier((e.target as HTMLInputElement).value)}
              autoComplete="username"
            />

            <label className="lbl">Password / PIN</label>
            <div className="linput-row">
              <input
                className="linput"
                type={showPass ? 'text' : 'password'}
                placeholder="Enter your PIN"
                style={{ paddingRight: 44 }}
                value={password}
                ref={passwordRef}
                onChange={e => setPassword(e.target.value)}
                onInput={e => setPassword((e.target as HTMLInputElement).value)}
                autoComplete="current-password"
              />
              <button type="button" className="leye" onClick={() => setShowPass(v => !v)}>
                {showPass ? '🙈' : '👁'}
              </button>
            </div>

            <button
              type="submit"
              className="lbtn"
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 14, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={{ background: 'none', border: 'none', color: '#1DC96A', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                onClick={() => router.push('/forgot-password')}
              >
                Forgot password?
              </button>
              <span style={{ color: 'rgba(255,255,255,.25)', fontSize: 13 }}>·</span>
              <button
                type="button"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.55)', fontSize: 13, cursor: 'pointer' }}
                onClick={() => router.push('/unlock')}
              >
                Account locked?
              </button>
            </div>
          </form>
        )}

        <div className="login-foot">
          <strong style={{ color: 'rgba(255,255,255,.5)' }}>Vochus Easy Save Agent Portal</strong>
          <br />
          © 2026 Vochus Global Services Ltd. &nbsp;·&nbsp; Need access? Contact your supervisor.
        </div>
      </div>
    </div>
  )
}
