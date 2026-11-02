'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { blockNonDigit, digitsOnly } from '@/lib/numeric'
import Logo from '@/components/Logo'

type Stage = 'phone' | 'reset' | 'done'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('phone')
  const [phone, setPhone] = useState('')
  const [maskedTarget, setMaskedTarget] = useState('')
  const [channel, setChannel] = useState<'email' | 'sms'>('email')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function sendCode() {
    if (!phone.trim()) { setError('Enter your phone number'); return }
    setError(''); setLoading(true)
    try {
      const res = await fetch('/api/customer/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to send code'); return }
      setMaskedTarget(data.maskedTarget ?? data.maskedEmail ?? '')
      setChannel(data.channel === 'sms' ? 'sms' : 'email')
      setStage('reset')
    } finally { setLoading(false) }
  }

  async function resetPassword() {
    if (code.length !== 6) { setError('Enter the 6-digit code'); return }
    if (!newPassword || newPassword.length < 6) { setError('Password must be at least 6 characters'); return }
    setError(''); setLoading(true)
    try {
      const res = await fetch('/api/customer/forgot-password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), code, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Reset failed'); return }
      setStage('done')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <Logo size={56} style={{ marginBottom: 12 }} />
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 22, fontWeight: 900 }}>Forgot Password</div>
          <div style={{ fontSize: 13, color: 'var(--mu)', marginTop: 4 }}>
            {stage === 'phone' && 'Enter your phone number to receive a reset code'}
            {stage === 'reset' && `Code sent via ${channel === 'sms' ? 'SMS' : 'email'} to ${maskedTarget} — enter it below with your new password`}
            {stage === 'done' && 'Password reset successfully'}
          </div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
          {error && (
            <div style={{ background: 'var(--rdl)', color: 'var(--rd)', border: '1px solid rgba(192,57,43,.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
              {error}
            </div>
          )}

          {stage === 'phone' && (
            <>
              <label style={lblStyle}>Phone Number</label>
              <input value={phone} onChange={e => setPhone(digitsOnly(e.target.value).slice(0, 11))} type="tel" inputMode="numeric" maxLength={11} placeholder="080XXXXXXXX"
                style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1 }}
                onKeyDown={e => { if (e.key === 'Enter') { sendCode(); return } blockNonDigit(e) }} autoComplete="tel" />
              <button onClick={sendCode} disabled={loading} style={btnStyle}>
                {loading ? 'Sending…' : 'Send Reset Code'}
              </button>
            </>
          )}

          {stage === 'reset' && (
            <>
              <label style={lblStyle}>Verification Code</label>
              <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                type="tel" placeholder="000000" maxLength={6}
                style={{ fontSize: 28, fontWeight: 900, textAlign: 'center', letterSpacing: 8, fontFamily: 'monospace' }} />
              <label style={lblStyle}>New Password</label>
              <div style={{ position: 'relative' }}>
                <input value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  type={showPass ? 'text' : 'password'} placeholder="Min 6 characters"
                  style={{ paddingRight: 44 }}
                  onKeyDown={e => e.key === 'Enter' && resetPassword()} autoComplete="new-password" />
                <button type="button" onClick={() => setShowPass(p => !p)}
                  style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-72%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
              <button onClick={resetPassword} disabled={loading} style={btnStyle}>
                {loading ? 'Resetting…' : 'Reset Password'}
              </button>
              <button onClick={sendCode} disabled={loading} style={linkBtnStyle}>Resend code</button>
            </>
          )}

          {stage === 'done' && (
            <>
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 10 }}>✅</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Password Updated!</div>
                <div style={{ fontSize: 13, color: 'var(--mu)' }}>You can now sign in with your new password.</div>
              </div>
              <button onClick={() => router.push('/customer/login')} style={btnStyle}>Sign In →</button>
            </>
          )}
        </div>

        {stage === 'phone' && (
          <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--mu)' }}>
            Remember your password?{' '}
            <span style={{ color: 'var(--g)', fontWeight: 700, cursor: 'pointer' }} onClick={() => router.push('/customer/login')}>Sign In</span>
          </div>
        )}
      </div>
    </div>
  )
}

const lblStyle: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--mu)', letterSpacing: .3, marginBottom: 6 }
const btnStyle: React.CSSProperties = {
  width: '100%', padding: 15, background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)',
  border: 'none', borderRadius: 13, cursor: 'pointer',
  fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff',
  boxShadow: '0 6px 20px rgba(26,107,58,.35)', marginTop: 4,
}
const linkBtnStyle: React.CSSProperties = {
  width: '100%', marginTop: 10, background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 13, color: 'var(--g)', fontWeight: 700, padding: 4,
}
