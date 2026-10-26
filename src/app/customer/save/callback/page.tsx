'use client'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const reference = searchParams.get('reference') ?? searchParams.get('trxref') ?? ''
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying')
  const [message, setMessage] = useState('')
  const [newBalance, setNewBalance] = useState<number | null>(null)

  useEffect(() => {
    if (!reference) { setStatus('error'); setMessage('No payment reference found'); return }
    fetch('/api/customer/paystack/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.alreadyProcessed || data.amount) {
          setStatus('success')
          setNewBalance(data.newBalance ?? null)
          setMessage(data.alreadyProcessed ? 'Payment already recorded.' : `₦${data.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })} added to your savings!`)
        } else {
          setStatus('error')
          setMessage(data.error ?? 'Payment verification failed')
        }
      })
      .catch(() => { setStatus('error'); setMessage('Network error during verification') })
  }, [reference])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
        {status === 'verifying' && (
          <>
            <div style={{ width: 48, height: 48, border: '4px solid var(--gl)', borderTop: '4px solid var(--g)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Verifying payment…</div>
            <div style={{ fontSize: 13, color: 'var(--mu)', marginTop: 6 }}>Please wait</div>
          </>
        )}
        {status === 'success' && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--gm)', borderRadius: 18, padding: 24 }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>🎉</div>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 20, fontWeight: 900, color: 'var(--g)', marginBottom: 6 }}>Payment Successful!</div>
            <div style={{ fontSize: 14, color: 'var(--txt)', marginBottom: 8 }}>{message}</div>
            {newBalance !== null && (
              <div style={{ background: 'var(--gl)', borderRadius: 10, padding: '10px 14px', fontSize: 14, fontWeight: 700, color: 'var(--g)', marginBottom: 16 }}>
                New Balance: ₦{newBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
            <button onClick={() => router.push('/customer/dashboard')} style={{ width: '100%', padding: 14, background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)', border: 'none', borderRadius: 12, cursor: 'pointer', fontFamily: 'Plus Jakarta Sans', fontSize: 14, fontWeight: 800, color: '#fff' }}>
              Back to Dashboard
            </button>
          </div>
        )}
        {status === 'error' && (
          <div style={{ background: 'var(--card)', border: '1px solid rgba(192,57,43,.2)', borderRadius: 18, padding: 24 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>❌</div>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 18, fontWeight: 900, color: 'var(--rd)', marginBottom: 6 }}>Payment Failed</div>
            <div style={{ fontSize: 13, color: 'var(--mu)', marginBottom: 16 }}>{message}</div>
            <button onClick={() => router.push('/customer/save')} style={{ width: '100%', padding: 14, background: 'var(--card)', border: '1.5px solid var(--br)', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>Loading…</div>}>
      <CallbackContent />
    </Suspense>
  )
}
