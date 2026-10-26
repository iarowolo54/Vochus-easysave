'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Logo from '@/components/Logo'

export default function SuperAdminLogin() {
  const router = useRouter()

  useEffect(() => { fetch('/api/admin-auth/logout', { method: 'POST' }) }, [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/admin-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })

      if (res.ok) {
        window.location.href = '/superadmin'
      } else {
        const data = await res.json()
        setError(data.error ?? 'Invalid email or password')
        setLoading(false)
      }
    } catch {
      setError('Sign in failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Serif:wght@400;600;700&display=swap"
        rel="stylesheet"
      />
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #071a0e 0%, #0e4d24 50%, #0a3318 100%)',
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}>
        <div style={{
          background: '#fff',
          borderRadius: 20,
          padding: '40px 36px',
          width: '100%',
          maxWidth: 420,
          boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
        }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <Logo size={60} style={{ display: 'flex', width: 'fit-content', margin: '0 auto 16px' }} />
            <div style={{ fontFamily: "'IBM Plex Serif', serif", fontSize: 22, fontWeight: 700, color: '#111a14', letterSpacing: '-0.3px' }}>
              Vochus Easy Save
            </div>
            <div style={{ fontSize: 12, color: '#8aaa94', letterSpacing: '2px', textTransform: 'uppercase', marginTop: 4 }}>
              Super Admin
            </div>
          </div>

          {error && (
            <div style={{
              background: '#fdecea',
              border: '1px solid rgba(192,57,43,0.25)',
              borderRadius: 9,
              padding: '10px 14px',
              fontSize: 13,
              color: '#8b1c1c',
              marginBottom: 18,
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#4a5e52', marginBottom: 6 }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@vochus.ng"
                required
                style={{
                  width: '100%',
                  padding: '10px 13px',
                  border: '1.5px solid #d8e8dd',
                  borderRadius: 9,
                  fontSize: 13,
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  color: '#111a14',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#4a5e52', marginBottom: 6 }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  width: '100%',
                  padding: '10px 13px',
                  border: '1.5px solid #d8e8dd',
                  borderRadius: 9,
                  fontSize: 13,
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  color: '#111a14',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                background: 'linear-gradient(135deg, #1a6b3a, #0e4d24)',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "'IBM Plex Sans', sans-serif",
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                boxShadow: '0 4px 16px rgba(26,107,58,0.35)',
              }}
            >
              {loading ? 'Signing In…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
