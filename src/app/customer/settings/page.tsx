'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import BottomNav from '@/components/BottomNav'

type CustomerData = { customerId: string; name: string; phone: string; email: string | null; photoUrl: string | null }

export default function CustomerSettingsPage() {
  const router = useRouter()
  const [data, setData] = useState<CustomerData | null>(null)

  useEffect(() => {
    fetch('/api/customer/me')
      .then(async r => {
        if (r.status === 401 || r.status === 404) {
          router.push('/customer/login')
          return null
        }
        return r.json()
      })
      .then(d => { if (d) setData(d) })
  }, [router])

  async function logout() {
    await fetch('/api/customer/auth/login', { method: 'DELETE' })
    router.push('/customer/login')
  }

  if (!data) return null

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 80 }}>
      <div style={{
        position: 'sticky', top: 0, height: 56, zIndex: 200,
        background: 'linear-gradient(135deg,#071a0e,#0e4d24)',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
        boxShadow: '0 2px 12px rgba(0,0,0,.3)',
      }}>
        {data.photoUrl
          ? <img src={data.photoUrl} style={{ width: 34, height: 34, borderRadius: 9, objectFit: 'cover', border: '2px solid rgba(255,255,255,.3)', flexShrink: 0 }} alt="" />
          : <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#2ecc71,#1a6b3a)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Plus Jakarta Sans', fontSize: 16, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
              {data.name[0]}
            </div>
        }
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff' }}>Settings</div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>{data.customerId}</div>
        </div>
        <button onClick={logout} style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 8, color: '#fff', fontSize: 11, fontWeight: 700, padding: '5px 10px', cursor: 'pointer' }}>Logout</button>
      </div>

      <div style={{ padding: 16, maxWidth: 480, margin: '0 auto' }}>
        <div style={{ background: 'var(--card)', borderRadius: 16, padding: 20, marginBottom: 16, boxShadow: '0 2px 12px rgba(0,0,0,.05)' }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, marginBottom: 16 }}>Account Info</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'Name', value: data.name },
              { label: 'Phone', value: data.phone },
              { label: 'Customer ID', value: data.customerId },
              ...(data.email ? [{ label: 'Email', value: data.email }] : []),
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--br)', paddingBottom: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--mu)' }}>{row.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: 'var(--card)', borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,.05)' }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, marginBottom: 8 }}>📱 Mobile App</div>
          <p style={{ fontSize: 13, color: 'var(--mu)', marginBottom: 16, lineHeight: 1.5 }}>
            Get the Vochus Easy Save app for a faster, native experience on your Android phone.
          </p>
          <a
            href="/downloads/easysave-customer.apk"
            download
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: 'var(--g)', color: '#fff', textDecoration: 'none',
              padding: '14px 0', borderRadius: 12, fontWeight: 700, fontSize: 15,
              fontFamily: 'Plus Jakarta Sans',
            }}
          >
            📥 Download Customer App (Android)
          </a>
        </div>
      </div>

      <BottomNav items={[
        { key: 'home',     icon: '🏠', label: 'Home',     href: '/customer/dashboard' },
        { key: 'save',     icon: '💳', label: 'Save',     href: '/customer/save' },
        { key: 'history',  icon: '📊', label: 'History',  href: '/customer/transactions' },
        { key: 'chat',     icon: '💬', label: 'Chat',     href: '/customer/chat' },
        { key: 'settings', icon: '⚙️', label: 'Settings', href: '/customer/settings' },
      ]} />
    </div>
  )
}
