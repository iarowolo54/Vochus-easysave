'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { blockNonDigit, digitsOnly } from '@/lib/numeric'

export default function UnlockPage() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [sentTo, setSentTo] = useState('')
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const requestedOnce = useRef(false)

  async function sendCode(p: string) {
    if (!p) return
    setError('')
    setSending(true)
    try {
      const res = await fetch('/api/customer/auth/unlock/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: p }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 429) {
        setCooldown(Number(data.retryAfterSeconds) || 60)
        return
      }
      if (!res.ok) { setError(data.error ?? 'Could not send a code. Try again.'); return }
      if (data.sentTo) setSentTo(data.sentTo)
      setCooldown(60)
    } catch {
      setError('Network error — check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  // Read the phone from the URL and send the first code automatically.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('phone') ?? ''
    setPhone(p)
    if (p && !requestedOnce.current) {
      requestedOnce.current = true
      sendCode(p)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tick the resend cooldown down to zero.
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function verify() {
    setError('')
    if (code.length !== 6) { setError('Enter the 6-digit code'); return }
    setVerifying(true)
    try {
      const res = await fetch('/api/customer/auth/unlock/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Invalid or expired code'); return }
      router.push('/customer/login?unlocked=1')
    } catch {
      setError('Network error — check your connection and try again.')
    } finally {
      setVerifying(false)
    }
  }

  const card: React.CSSProperties = {
    background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 16,
    padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,.06)',
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 22, fontWeight: 900, color: 'var(--txt)' }}>Unlock your account</div>
          <div style={{ fontSize: 13, color: 'var(--mu)', marginTop: 6, lineHeight: 1.5 }}>
            Your account was locked after too many failed attempts. Enter the code we sent you to unlock it.
          </div>
        </div>

        <div style={card}>
          {error && (
            <div style={{ background: 'var(--rdl)', color: 'var(--rd)', border: '1px solid rgba(192,57,43,.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
              {error}
            </div>
          )}

          {!phone ? (
            <div style={{ fontSize: 13, color: 'var(--mu)', textAlign: 'center' }}>
              We couldn&apos;t tell which account to unlock.{' '}
              <span style={{ color: 'var(--g)', fontWeight: 700, cursor: 'pointer' }} onClick={() => router.push('/customer/login')}>Back to login</span>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: 'var(--mu)', marginBottom: 14, minHeight: 20 }}>
                {sending ? 'Sending a code…' : sentTo ? <>Code sent to <strong style={{ color: 'var(--txt)' }}>{sentTo}</strong></> : 'Tap “Resend code” to get a code.'}
              </div>

              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--mu)', letterSpacing: .3, marginBottom: 6 }}>Verification code</label>
              <input
                value={code}
                onChange={(e) => setCode(digitsOnly(e.target.value).slice(0, 6))}
                type="tel" inputMode="numeric" maxLength={6} placeholder="______"
                style={{ fontSize: 22, fontWeight: 800, letterSpacing: 8, textAlign: 'center' }}
                onKeyDown={(e) => { if (e.key === 'Enter') { verify(); return } blockNonDigit(e) }}
                autoFocus
              />

              <button
                onClick={verify} disabled={verifying || code.length !== 6}
                style={{
                  width: '100%', marginTop: 4, padding: 15, background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)',
                  border: 'none', borderRadius: 13, cursor: 'pointer', fontFamily: 'Plus Jakarta Sans',
                  fontSize: 15, fontWeight: 800, color: '#fff', boxShadow: '0 6px 20px rgba(26,107,58,.35)',
                  opacity: verifying || code.length !== 6 ? .6 : 1,
                }}
              >{verifying ? 'Verifying…' : 'Unlock account'}</button>

              <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13, color: 'var(--mu)' }}>
                {cooldown > 0 ? (
                  <span>Resend code in {cooldown}s</span>
                ) : (
                  <span style={{ color: 'var(--g)', fontWeight: 700, cursor: 'pointer' }} onClick={() => sendCode(phone)}>Resend code</span>
                )}
              </div>
            </>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13 }}>
          <span style={{ color: 'var(--g)', fontWeight: 700, cursor: 'pointer' }} onClick={() => router.push('/customer/login')}>Back to login</span>
        </div>
      </div>
    </div>
  )
}
