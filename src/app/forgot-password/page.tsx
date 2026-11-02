'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Logo from '@/components/Logo'
import { Icons } from '@/components/ui/icons'
import { RESENT_MESSAGE, useResendCooldown, waitMessage } from '@/components/useResendCooldown'

type Stage = 'identifier' | 'reset' | 'done'

export default function AgentForgotPasswordPage() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('identifier')
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // A resend inside the cooldown returns a throwaway id and sends nothing, so keep the id of the code already on its way.
  const sent = useRef<{ id: string; at: number } | null>(null)
  const fromLink = useRef(false)

  useEffect(() => {
    // An admin-sent code arrives with a link carrying its resetId.
    const r = new URLSearchParams(window.location.search).get('r')
    if (r) { sent.current = { id: r, at: 0 }; fromLink.current = true }
  }, [])

  function remember(id: unknown) {
    if (typeof id === 'string' && (!sent.current || Date.now() - sent.current.at >= 60_000)) sent.current = { id, at: Date.now() }
  }

  const { secondsLeft, start: startCooldown } = useResendCooldown()
  const [notice, setNotice] = useState('')

  async function sendCode() {
    if (!identifier.trim()) { setError('Enter your Agent ID or phone number'); return }
    if (stage === 'reset' && secondsLeft > 0) { setError(''); setNotice(waitMessage(secondsLeft)); return }
    if (fromLink.current) { fromLink.current = false; setError(''); setStage('reset'); return }
    setError(''); setLoading(true)
    try {
      const res = await fetch('/api/agent/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to send code'); return }
      remember(data.resetId)
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
      const res = await fetch('/api/agent/forgot-password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), code, newPassword, resetId: sent.current?.id }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Reset failed'); return }
      setStage('done')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'linear-gradient(135deg,#051810 0%,#0A3520 50%,#0C4824 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Logo size={56} tile style={{ marginBottom: 12 }} />
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 'clamp(20px, 5vw, 26px)', fontWeight: 900, color: '#fff' }}>Reset Password</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 4 }}>
            {stage === 'identifier' && 'Enter your Agent ID or phone to receive a reset code'}
            {stage === 'reset' && 'If this account has an email on file, we’ve sent a 6-digit code to it. It can take a minute to arrive. Enter it below with your new password. No email on file? Contact your administrator.'}
            {stage === 'done' && 'Password reset successfully'}
          </div>
        </div>

        <div style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: 22, backdropFilter: 'blur(10px)' }}>
          {error && (
            <div style={{ background: 'rgba(192,57,43,.15)', color: '#ff8a80', border: '1px solid rgba(192,57,43,.3)', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
              {error}
            </div>
          )}

          {stage === 'identifier' && (
            <>
              <label style={lblStyle}>Agent ID or Phone</label>
              <input value={identifier} onChange={e => setIdentifier(e.target.value)} type="text" placeholder="AGT-00001 or 080XXXXXXXX"
                style={inputStyle}
                onKeyDown={e => e.key === 'Enter' && sendCode()} autoCapitalize="characters" />
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
                style={{ ...inputStyle, fontSize: 28, fontWeight: 900, textAlign: 'center', letterSpacing: 8, fontFamily: 'monospace' }} />
              <label style={lblStyle}>New Password</label>
              <div style={{ position: 'relative' }}>
                <input value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  type={showPass ? 'text' : 'password'} placeholder="Min 6 characters"
                  style={{ ...inputStyle, paddingRight: 44 }}
                  onKeyDown={e => e.key === 'Enter' && resetPassword()} autoComplete="new-password" />
                <button type="button" aria-label={showPass ? 'Hide password' : 'Show password'} onClick={() => setShowPass(p => !p)}
                  style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-72%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#fff' }}>
                  {showPass ? <Icons.hide size={20} aria-hidden="true" /> : <Icons.show size={20} aria-hidden="true" />}
                </button>
              </div>
              <button onClick={resetPassword} disabled={loading} style={btnStyle}>
                {loading ? 'Resetting…' : 'Reset Password'}
              </button>
              <button onClick={sendCode} disabled={loading} style={linkBtnStyle}>{secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}</button>
              {notice && <p role="status" style={{ marginTop: 8, fontSize: 13, textAlign: 'center', color: 'rgba(255,255,255,.8)' }}>{notice}</p>}
            </>
          )}

          {stage === 'done' && (
            <>
              <div style={{ textAlign: 'center', padding: '16px 0', color: '#fff' }}>
                <div style={{ marginBottom: 10, color: '#1DC96A' }}><Icons.check size={48} aria-hidden="true" /></div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Password Updated!</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)' }}>You can now sign in with your new password.</div>
              </div>
              <button onClick={() => router.push('/login')} style={btnStyle}>Sign In →</button>
            </>
          )}
        </div>

        {stage === 'identifier' && (
          <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,.6)' }}>
            Remember your password?{' '}
            <span style={{ color: '#1DC96A', fontWeight: 700, cursor: 'pointer' }} onClick={() => router.push('/login')}>Sign In</span>
          </div>
        )}
      </div>
    </div>
  )
}

const lblStyle: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, color: 'rgba(255,255,255,.7)', letterSpacing: .3, marginBottom: 6 }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '13px 14px', background: 'rgba(255,255,255,.06)', border: '1.5px solid rgba(255,255,255,.12)',
  borderRadius: 11, color: '#fff', fontSize: 15, outline: 'none', marginBottom: 13, boxSizing: 'border-box',
}
const btnStyle: React.CSSProperties = {
  width: '100%', padding: 15, background: 'linear-gradient(135deg,#0D6B3A,#1DC96A)',
  border: 'none', borderRadius: 13, cursor: 'pointer',
  fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff',
  boxShadow: '0 6px 20px rgba(29,201,106,.35)', marginTop: 4,
}
const linkBtnStyle: React.CSSProperties = {
  width: '100%', marginTop: 10, background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 13, color: '#1DC96A', fontWeight: 700, padding: 4,
}
