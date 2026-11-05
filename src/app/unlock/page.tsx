'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Logo from '@/components/Logo'
import { Icons } from '@/components/ui/icons'
import { RESENT_MESSAGE, useResendCooldown, useResetId, waitMessage } from '@/components/useResendCooldown'

const BODY: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,.85)', textAlign: 'center', marginBottom: 20, lineHeight: 1.6 }
const LABEL: React.CSSProperties = { color: 'rgba(255,255,255,.85)' }
const LINK: React.CSSProperties = { background: 'none', border: 'none', color: 'rgba(255,255,255,.85)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: 8, minHeight: 44 }

type Step = 'identify' | 'reset' | 'done'

export default function UnlockPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('identify')
  const [identifier, setIdentifier] = useState('')
  const [token, setToken] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { secondsLeft, start: startCooldown } = useResendCooldown()
  const { remember, idFor, forget, changeAccount } = useResetId('unlock', (account, cooldownLeft) => {
    setIdentifier(account)
    setStep('reset')
    startCooldown(cooldownLeft)
  })
  const [notice, setNotice] = useState('')

  async function requestUnlock() {
    if (!identifier.trim()) return
    if (step === 'reset' && secondsLeft > 0) { setError(''); setNotice(waitMessage(secondsLeft)); return }
    setLoading(true)
    setError('')
    const res = await fetch('/api/agent/unlock/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: identifier.trim() }),
    })
    const data = await res.json().catch(() => ({}))
    setLoading(false)
    if (res.ok) {
      remember(data.resetId, identifier.trim())
      startCooldown()
      setNotice(step === 'reset' ? RESENT_MESSAGE : '')
      setStep('reset')
    } else {
      setError(data.error ?? 'Request failed')
    }
  }

  async function resetPin() {
    if (token.length !== 6) { setError('Enter the 6-digit code'); return }
    if (newPin !== confirmPin) { setError('Passwords do not match'); return }
    if (newPin.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true)
    setError('')
    setNotice('')
    const res = await fetch('/api/agent/unlock/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: identifier.trim(), token: token.trim(), newPin, resetId: idFor(identifier.trim()) }),
    })
    const data = await res.json().catch(() => ({}))
    setLoading(false)
    if (res.ok) {
      forget()
      setStep('done')
    } else {
      setError(data.error ?? 'Reset failed')
    }
  }

  return (
    <div className="login-page">
      <div className="login-wrap">
        <Logo size={72} tile />
        <div className="login-brand">
          <h1>Vochus Easy Save</h1>
          <p>Account Unlock</p>
        </div>

        {step === 'identify' && (
          <div className="login-card">
            <div style={{ textAlign: 'center', marginBottom: 12, color: '#fff' }}><Icons.locked size={32} aria-hidden="true" /></div>
            <h2 style={{ textAlign: 'center', marginBottom: 6 }}>Unlock Your Account</h2>
            <p style={BODY}>
              Enter your Agent ID or registered phone number. We'll send an unlock code to your confirmed email, or by SMS if you have none.
            </p>
            {error && <div className="lerr">{error}</div>}
            <label className="lbl" style={LABEL} htmlFor="unlock-identifier">Agent ID / Phone Number</label>
            <input
              id="unlock-identifier"
              className="linput"
              type="text"
              placeholder="e.g. AGT-00142 or 0801 234 5678"
              value={identifier}
              onChange={e => { changeAccount(); setIdentifier(e.target.value) }}
              autoComplete="off"
              onKeyDown={e => e.key === 'Enter' && requestUnlock()}
            />
            <button
              className="lbtn"
              disabled={!identifier.trim() || loading}
              onClick={requestUnlock}
              style={{ marginTop: 8 }}
            >
              {loading ? 'Sending…' : 'Send Unlock Code →'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button type="button" style={LINK} onClick={() => router.push('/login')}>
                ← Back to Login
              </button>
            </div>
          </div>
        )}

        {step === 'reset' && (
          <div className="login-card">
            <div style={{ textAlign: 'center', marginBottom: 12, color: '#fff' }}><Icons.phone size={32} aria-hidden="true" /></div>
            <h2 style={{ textAlign: 'center', marginBottom: 6 }}>Enter Code and New Password</h2>
            <p style={BODY}>
              If this account is locked, we’ve sent it a 6-digit code, to its confirmed email or else by SMS. It can take a minute to arrive (check spam), and expires in 10 minutes.
            </p>
            {error && <div className="lerr" role="alert">{error}</div>}
            <label className="lbl" style={LABEL} htmlFor="unlock-code">Unlock Code</label>
            <input
              id="unlock-code"
              className="linput"
              type="text"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={token}
              onChange={e => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ letterSpacing: 6, fontSize: 22, textAlign: 'center' }}
            />
            <label className="lbl" style={{ ...LABEL, marginTop: 12 }} htmlFor="unlock-password">New password</label>
            <div className="linput-row">
              <input
                id="unlock-password"
                className="linput"
                type={showPin ? 'text' : 'password'}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                style={{ paddingRight: 44 }}
                value={newPin}
                onChange={e => setNewPin(e.target.value)}
              />
              <button type="button" className="leye" aria-label={showPin ? 'Hide password' : 'Show password'} onClick={() => setShowPin(v => !v)}>
                {showPin ? <Icons.hide size={20} aria-hidden="true" /> : <Icons.show size={20} aria-hidden="true" />}
              </button>
            </div>
            <label className="lbl" style={{ ...LABEL, marginTop: 12 }} htmlFor="unlock-confirm">Confirm password</label>
            <input
              id="unlock-confirm"
              className="linput"
              type={showPin ? 'text' : 'password'}
              placeholder="Re-enter new password"
              autoComplete="new-password"
              value={confirmPin}
              onChange={e => setConfirmPin(e.target.value)}
            />
            <button
              className="lbtn"
              disabled={token.length !== 6 || !newPin || !confirmPin || loading}
              onClick={resetPin}
              style={{ marginTop: 16 }}
            >
              {loading ? 'Saving…' : 'Unlock and Set Password →'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 14, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
              <button type="button" style={LINK} onClick={() => { changeAccount(); setToken(''); setError(''); setNotice(''); setStep('identify') }}>
                ← Change Agent ID
              </button>
              <button type="button" style={LINK} disabled={loading} onClick={() => { setError(''); requestUnlock() }}>
                {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
              </button>
            </div>
            {notice && <p role="status" style={{ ...BODY, marginTop: 8, marginBottom: 0 }}>{notice}</p>}
          </div>
        )}

        {step === 'done' && (
          <div className="login-card" style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 12, color: '#1DC96A' }}><Icons.check size={40} aria-hidden="true" /></div>
            <h2 style={{ marginBottom: 8 }}>Account Unlocked!</h2>
            <p style={{ ...BODY, fontSize: 14, marginBottom: 24 }}>
              Your account has been unlocked and your password has been updated.<br />
              You can now sign in with your new password.
            </p>
            <button className="lbtn" onClick={() => router.push('/login')}>
              Go to Login →
            </button>
          </div>
        )}

        <div className="login-foot" style={{ color: 'rgba(255,255,255,.8)' }}>
          <strong>Vochus Easy Save Agent Portal</strong>
          <br />
          © 2026 Zipwaves Technologies Limited
        </div>
      </div>
    </div>
  )
}
