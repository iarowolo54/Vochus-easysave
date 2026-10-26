'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import BottomNav from '@/components/BottomNav'

type Plan = {
  id: string; dailyAmount: number; periodDays: number; cadence?: string; goal: string
  startDate: string; maturityDate: string; balance: number; status: string
}
type Tx = { id: string; amount: number; ref: string; createdAt: string; method: string }
type CustomerData = {
  customerId: string; name: string; phone: string; email: string | null; photoUrl: string | null
  agent: { name: string; agentId: string; phone: string }
  plan: Plan | null
  plans: Plan[]
  recentTransactions: Tx[]
  pendingRedemption: { ref: string; status: string } | null
}

export default function CustomerDashboard() {
  const router = useRouter()
  const [data, setData] = useState<CustomerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activePlanIdx, setActivePlanIdx] = useState(0)

  useEffect(() => {
    fetch('/api/customer/me')
      .then(async r => {
        if (r.status === 401 || r.status === 404) {
          // clear stale cookie server-side too
          await fetch('/api/customer/auth/login', { method: 'DELETE' }).catch(() => {})
          router.push('/customer/login')
          return null
        }
        return r.json()
      })
      .then(d => { if (d) setData(d) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!data) return
    const w = window as unknown as {
      __vochusCanBiometric?: boolean
      __vochusBiometricEnrolled?: boolean
      __vochusDeviceId?: string
      VochusBiometric?: { postMessage: (s: string) => void }
    }
    if (!w.__vochusCanBiometric || w.__vochusBiometricEnrolled || !w.VochusBiometric) return
    ;(async () => {
      try {
        const r = await fetch('/api/customer/auth/biometric/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: w.__vochusDeviceId ?? '' }),
        })
        if (!r.ok) return
        const d = await r.json()
        w.VochusBiometric!.postMessage(JSON.stringify({ token: d.token, identifier: d.identifier }))
      } catch {}
    })()
  }, [data])

  async function logout() {
    await fetch('/api/customer/auth/login', { method: 'DELETE' })
    router.push('/customer/login')
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 12, background: 'var(--bg)' }}>
      <div style={{ width: 40, height: 40, border: '3px solid var(--gl)', borderTop: '3px solid var(--g)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (!data) return null

  const plans = data.plans ?? (data.plan ? [data.plan] : [])
  const plan = plans[activePlanIdx] ?? null
  const pct = plan ? Math.min(100, Math.round((plan.balance / (plan.dailyAmount * plan.periodDays)) * 100)) : 0
  const daysLeft = plan ? Math.max(0, Math.ceil((new Date(plan.maturityDate).getTime() - Date.now()) / 86400000)) : 0
  const savedDays = plan ? Math.round(plan.balance / plan.dailyAmount) : 0
  const pendingRedemption = data.pendingRedemption

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 80 }}>
      {/* Top bar */}
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
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 15, fontWeight: 800, color: '#fff' }}>{data.name}</div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>{data.customerId}</div>
        </div>
        <button onClick={logout} style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 8, color: '#fff', fontSize: 11, fontWeight: 700, padding: '5px 10px', cursor: 'pointer' }}>Logout</button>
      </div>

      <div style={{ padding: 16 }}>
        {/* Plan switcher tabs (if multiple plans) */}
        {plans.length > 1 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, overflowX: 'auto', paddingBottom: 2 }}>
            {plans.map((p, i) => (
              <button key={p.id} onClick={() => setActivePlanIdx(i)} style={{
                flexShrink: 0, padding: '6px 14px', borderRadius: 20,
                border: `1.5px solid ${i === activePlanIdx ? 'var(--g)' : 'var(--br)'}`,
                background: i === activePlanIdx ? 'var(--gl)' : 'var(--card)',
                color: i === activePlanIdx ? 'var(--g)' : 'var(--mu)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
                {p.goal} · ₦{(p.cadence ?? 'daily') === 'weekly' ? (p.dailyAmount * 7).toLocaleString() : p.dailyAmount.toLocaleString()}/{(p.cadence ?? 'daily') === 'weekly' ? 'w' : 'd'}
              </button>
            ))}
          </div>
        )}

        {/* Balance hero */}
        {plan ? (
          <div style={{ background: 'linear-gradient(135deg,#071a0e,#0e4d24)', borderRadius: 18, padding: '20px 20px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,.45)' }}>Savings Balance</div>
              {data.recentTransactions && data.recentTransactions.length > 0 && (
                <button onClick={() => router.push('/customer/transactions')} style={{
                  background: 'none', border: 'none', color: 'rgba(255,255,255,.45)', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  Contribution History →
                </button>
              )}
            </div>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 36, fontWeight: 900, color: '#fff' }}>₦{plan.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>
              {(plan.cadence ?? 'daily') === 'weekly'
                ? `₦${(plan.dailyAmount * 7).toLocaleString()}/week · ${plan.periodDays / 7} weeks · ${plan.goal}`
                : `₦${plan.dailyAmount.toLocaleString()}/day · ${plan.periodDays} days · ${plan.goal}`
              }
            </div>
            <div style={{ height: 8, background: 'rgba(255,255,255,.15)', borderRadius: 100, overflow: 'hidden', marginTop: 14 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#2ecc71,#6edfa0)', borderRadius: 100, transition: 'width 1s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 5 }}>
              <span>{pct}% complete</span>
              <span>Matures {new Date(plan.maturityDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
          </div>
        ) : (
          <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 16, padding: 20, textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>💰</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>No Active Plan</div>
            <div style={{ fontSize: 13, color: 'var(--mu)' }}>Start a new savings plan below.</div>
          </div>
        )}

        {/* Stats row */}
        {plan && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
            {[
              { icon: '🔥', val: savedDays, lbl: 'Days Saved', bg: 'var(--gdl)', col: 'var(--gd)' },
              { icon: '📅', val: daysLeft, lbl: 'Days Left', bg: 'var(--bl)', col: 'var(--b)' },
              { icon: '📊', val: `${pct}%`, lbl: 'Progress', bg: 'var(--gl)', col: 'var(--g)' },
            ].map(s => (
              <div key={s.lbl} style={{ background: s.bg, borderRadius: 13, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{s.icon}</div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 20, fontWeight: 900, color: s.col }}>{s.val}</div>
                <div style={{ fontSize: 10, color: 'var(--mu)', marginTop: 2 }}>{s.lbl}</div>
              </div>
            ))}
          </div>
        )}


        {/* Redemption pending notice */}
        {pendingRedemption && (
          <div style={{
            background: 'var(--rdl)', border: '1px solid rgba(192,57,43,.25)', borderRadius: 12,
            padding: '11px 14px', marginBottom: 12, fontSize: 13, color: 'var(--rd)', lineHeight: 1.5,
          }}>
            🔒 <strong>Savings locked</strong> — You have a pending redemption request. New savings are disabled until it is resolved.{' '}
            <span style={{ fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => router.push('/customer/redeem')}>View request →</span>
          </div>
        )}

        {/* Quick actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <button
            disabled={!!pendingRedemption}
            onClick={() => !pendingRedemption && router.push(plan ? `/customer/save?planId=${plan.id}` : '/customer/save')}
            style={{
              padding: '14px 12px',
              background: pendingRedemption ? 'var(--br)' : 'linear-gradient(135deg,#2ecc71,#1a6b3a)',
              border: 'none', borderRadius: 13,
              cursor: pendingRedemption ? 'not-allowed' : 'pointer',
              color: pendingRedemption ? 'var(--mu)' : '#fff',
              fontFamily: 'Plus Jakarta Sans', fontSize: 14, fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: pendingRedemption ? 'none' : '0 4px 14px rgba(26,107,58,.3)',
              opacity: pendingRedemption ? .6 : 1,
            }}
          >{pendingRedemption ? '🔒 Save Locked' : '💳 Save Now'}</button>
          <button onClick={() => router.push('/customer/redeem')} style={{
            padding: '14px 12px', background: 'var(--card)', border: '1.5px solid var(--br)',
            borderRadius: 13, cursor: 'pointer', fontSize: 14, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>💸 Redeem</button>
        </div>

        {/* New plan button (hidden when redemption pending) */}
        {!pendingRedemption && (
          <button onClick={() => router.push('/customer/save?new=1')} style={{
            width: '100%', marginBottom: 16, padding: '12px', background: 'var(--card)',
            border: '1.5px dashed var(--gm)', borderRadius: 13, cursor: 'pointer',
            fontSize: 13.5, fontWeight: 700, color: 'var(--g)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>➕ Start New Savings Plan</button>
        )}

        {/* Recent transactions */}
        {data.recentTransactions.length > 0 && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>Recent Savings</div>
            {data.recentTransactions.slice(0, 10).map(tx => (
              <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--br)', fontSize: 13.5 }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--g)' }}>+₦{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div style={{ fontSize: 11, color: 'var(--mu)', marginTop: 2 }}>{new Date(tx.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {tx.method}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--mu)', fontFamily: 'monospace' }}>{tx.ref.slice(0, 14)}…</div>
              </div>
            ))}
          </div>
        )}

        {/* Agent info */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--br)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>My Agent</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
            <span style={{ color: 'var(--mu)' }}>Name</span>
            <strong>{data.agent.name}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginTop: 8 }}>
            <span style={{ color: 'var(--mu)' }}>ID</span>
            <strong style={{ fontFamily: 'monospace', color: 'var(--g)' }}>{data.agent.agentId}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginTop: 8 }}>
            <span style={{ color: 'var(--mu)' }}>Phone</span>
            <a href={`tel:${data.agent.phone}`} style={{ fontWeight: 700, color: 'var(--b)' }}>{data.agent.phone}</a>
          </div>
          <button onClick={() => router.push('/customer/chat')} style={{
            width: '100%', marginTop: 12, padding: 11, background: 'var(--gl)', border: '1px solid var(--gm)',
            borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--g)',
          }}>💬 Chat with Agent</button>
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
