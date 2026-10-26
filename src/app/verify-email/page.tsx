'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function VerifyContent() {
  const params = useSearchParams()
  const success = params.get('success')
  const error = params.get('error')

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f9f6' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '48px 40px', maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>
        {success ? (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h2 style={{ color: '#1a5c35', marginBottom: 8 }}>Email Verified!</h2>
            <p style={{ color: '#666', marginBottom: 24 }}>Your Vochus Easy Save account is now active. You can log in.</p>
            <a href="/" style={{ display: 'inline-block', background: '#1a5c35', color: '#fff', padding: '12px 28px', borderRadius: 8, textDecoration: 'none', fontWeight: 600 }}>Go to Login</a>
          </>
        ) : error === 'invalid' ? (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
            <h2 style={{ color: '#c0392b', marginBottom: 8 }}>Invalid Link</h2>
            <p style={{ color: '#666' }}>This verification link is invalid or has already been used. Contact your administrator.</p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ color: '#e67e22', marginBottom: 8 }}>Missing Token</h2>
            <p style={{ color: '#666' }}>No verification token found. Check your email for the correct link.</p>
          </>
        )}
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyContent />
    </Suspense>
  )
}
