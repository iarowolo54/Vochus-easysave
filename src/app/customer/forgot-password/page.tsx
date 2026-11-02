'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { blockNonDigit, digitsOnly } from '@/lib/numeric'
import Logo from '@/components/Logo'
import { Icons } from '@/components/ui/icons'
import { RESENT_MESSAGE, useResendCooldown, useResetId, waitMessage } from '@/components/useResendCooldown'

type Stage = 'phone' | 'reset' | 'done'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const { remember, idFor, forget, fromLink, clearFromLink } = useResetId('customer')
  const { secondsLeft, start: startCooldown } = useResendCooldown()
  const [notice, setNotice] = useState('')

  async function sendCode() {
    if (!phone.trim()) { setError('Enter your phone number'); return }
    if (stage === 'reset' && secondsLeft > 0) { setError(''); setNotice(waitMessage(secondsLeft)); return }
    if (fromLink) { clearFromLink(); setError(''); setStage('reset'); return }
    setError(''); setLoading(true)
    try {
      const res = await fetch('/api/customer/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to send code'); return }
      remember(data.resetId, phone.trim())
      startCooldown()
      setNotice(stage === 'reset' ? RESENT_MESSAGE : '')
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
        body: JSON.stringify({ phone: phone.trim(), code, newPassword, resetId: idFor(phone.trim()) }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Reset failed'); return }
      forget()
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
            {stage === 'reset' && 'If this number has an account, we’ve sent a 6-digit code by SMS or email. It can take a minute to arrive. Enter it below with your new password.'}
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
                <button type="button" aria-label={showPass ? 'Hide password' : 'Show password'} onClick={() => setShowPass(p => !p)}
                  style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-72%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>
                  {showPass ? <Icons.hide size={20} aria-hidden="true" /> : <Icons.show size={20} aria-hidden="true" />}
                </button>
              </div>
              <button onClick={resetPassword} disabled={loading} style={btnStyle}>
                {loading ? 'Resetting…' : 'Reset Password'}
              </button>
              <button onClick={sendCode} disabled={loading} style={linkBtnStyle}>{secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}</button>
              {notice && <p role="status" style={{ marginTop: 8, fontSize: 13, textAlign: 'center', color: 'var(--mu)' }}>{notice}</p>}
            </>
          )}

          {stage === 'done' && (
            <>
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ marginBottom: 10, color: '#1DC96A' }}><Icons.check size={48} aria-hidden="true" /></div>
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
