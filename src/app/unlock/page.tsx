'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Step = 'identify' | 'verify' | 'reset' | 'done'

export default function UnlockPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('identify')
  const [identifier, setIdentifier] = useState('')
  const [maskedPhone, setMaskedPhone] = useState('')
  const [token, setToken] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function requestUnlock() {
    if (!identifier.trim()) return
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
      setMaskedPhone(data.phone)
      setStep('verify')
    } else {
      setError(data.error ?? 'Request failed')
    }
  }

  async function resetPin() {
    if (newPin !== confirmPin) { setError('PINs do not match'); return }
    if (newPin.length < 4) { setError('PIN must be at least 4 characters'); return }
    setLoading(true)
    setError('')
    const res = await fetch('/api/agent/unlock/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: identifier.trim(), token: token.trim(), newPin }),
    })
    const data = await res.json().catch(() => ({}))
    setLoading(false)
    if (res.ok) {
      setStep('done')
    } else {
      setError(data.error ?? 'Reset failed')
    }
  }

  return (
    <div className="login-page">
      <div className="login-wrap">
        <div className="login-logo">V</div>
        <div className="login-brand">
          <h1>Vochus Easy Save</h1>
          <p>Account Unlock</p>
        </div>

        {step === 'identify' && (
          <div className="login-card">
            <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 12 }}>🔓</div>
            <h2 style={{ textAlign: 'center', marginBottom: 6 }}>Unlock Your Account</h2>
            <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', marginBottom: 20, lineHeight: 1.6 }}>
              Enter your Agent ID or registered phone number. We'll send an unlock code via SMS.
            </p>
            {error && <div className="lerr">{error}</div>}
            <label className="lbl">Agent ID / Phone Number</label>
            <input
              className="linput"
              type="text"
              placeholder="e.g. AGT-00142 or 0801 234 5678"
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
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
              <button
                type="button"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.5)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => router.push('/')}
              >
                ← Back to Login
              </button>
            </div>
          </div>
        )}

        {step === 'verify' && (
          <div className="login-card">
            <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 12 }}>📱</div>
            <h2 style={{ textAlign: 'center', marginBottom: 6 }}>Enter Unlock Code</h2>
            <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', marginBottom: 20, lineHeight: 1.6 }}>
              A 6-digit code was sent to <strong style={{ color: 'var(--text)' }}>{maskedPhone}</strong>.<br />
              It expires in 15 minutes.
            </p>
            {error && <div className="lerr">{error}</div>}
            <label className="lbl">Unlock Code</label>
            <input
              className="linput"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit code"
              value={token}
              onChange={e => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ letterSpacing: 6, fontSize: 22, textAlign: 'center' }}
            />
            <button
              className="lbtn"
              disabled={token.length !== 6 || loading}
              onClick={() => { setError(''); setStep('reset') }}
              style={{ marginTop: 8 }}
            >
              Verify Code →
            </button>
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button
                type="button"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.5)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => { setError(''); requestUnlock() }}
              >
                Resend code
              </button>
            </div>
          </div>
        )}

        {step === 'reset' && (
          <div className="login-card">
            <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 12 }}>🔑</div>
            <h2 style={{ textAlign: 'center', marginBottom: 6 }}>Create New PIN</h2>
            <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', marginBottom: 20, lineHeight: 1.6 }}>
              Choose a new PIN to secure your account.
            </p>
            {error && <div className="lerr">{error}</div>}
            <label className="lbl">New PIN</label>
            <div className="linput-row">
              <input
                className="linput"
                type={showPin ? 'text' : 'password'}
                placeholder="Enter new PIN"
                style={{ paddingRight: 44 }}
                value={newPin}
                onChange={e => setNewPin(e.target.value)}
              />
              <button type="button" className="leye" onClick={() => setShowPin(v => !v)}>
                {showPin ? '🙈' : '👁'}
              </button>
            </div>
            <label className="lbl" style={{ marginTop: 12 }}>Confirm PIN</label>
            <input
              className="linput"
              type={showPin ? 'text' : 'password'}
              placeholder="Re-enter new PIN"
              value={confirmPin}
              onChange={e => setConfirmPin(e.target.value)}
            />
            <button
              className="lbtn"
              disabled={!newPin || !confirmPin || loading}
              onClick={resetPin}
              style={{ marginTop: 16 }}
            >
              {loading ? 'Saving…' : 'Set New PIN →'}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="login-card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <h2 style={{ marginBottom: 8 }}>Account Unlocked!</h2>
            <p style={{ color: 'var(--text3)', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
              Your account has been unlocked and your PIN has been updated.<br />
              You can now sign in with your new PIN.
            </p>
            <button className="lbtn" onClick={() => router.push('/')}>
              Go to Login →
            </button>
          </div>
        )}

        <div className="login-foot">
          <strong style={{ color: 'rgba(255,255,255,.5)' }}>Vochus Easy Save Agent Portal</strong>
          <br />
          © 2026 Vochus Global Services Ltd.
        </div>
      </div>
    </div>
  )
}
