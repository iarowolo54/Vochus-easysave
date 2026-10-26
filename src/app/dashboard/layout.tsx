'use client'

import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import BottomNav from '@/components/BottomNav'
import { AGENT_NAV } from '@/components/nav-items'
import IdleTimeout from '@/components/IdleTimeout'
import Logo from '@/components/Logo'

const navItems = [
  { section: 'Main', items: [
    { label: 'Dashboard', icon: '🏠', href: '/dashboard' },
    { label: 'Customers', icon: '👥', href: '/dashboard/customers' },
    { label: 'Transactions', icon: '📊', href: '/dashboard/transactions' },
  ]},
  { section: 'Operations', items: [
    { label: 'Enrol Customer', icon: '📋', href: '/dashboard/enrol' },
    { label: 'Record Saving', icon: '💰', href: '/dashboard/savings' },
    { label: 'Savings Calendar', icon: '📅', href: '/dashboard/calendar' },
    { label: 'Redemption', icon: '🎯', href: '/dashboard/redeem' },
  ]},
  { section: 'Loans', items: [
    { label: 'Loan Request', icon: '🏦', href: '/dashboard/loan-request' },
    { label: 'Disbursement', icon: '💸', href: '/dashboard/loan-disburse' },
    { label: 'Repayment', icon: '🔄', href: '/dashboard/loan-repay' },
    { label: 'Interest Rates', icon: '📈', href: '/dashboard/interest-rates' },
  ]},
  { section: 'Finance', items: [
    { label: 'Wallet Funding', icon: '💼', href: '/dashboard/wallet' },
    { label: 'Commission', icon: '🏅', href: '/dashboard/commission' },
    { label: 'Withdraw', icon: '💸', href: '/dashboard/withdraw' },
    { label: 'Sub-Agents', icon: '🤝', href: '/dashboard/subagents' },
  ]},
  { section: 'Account', items: [
    { label: 'Support Chat', icon: '💬', href: '/dashboard/chat' },
    { label: 'Settings', icon: '⚙️', href: '/dashboard/settings' },
    { label: 'Report Issue', icon: '🚨', href: '/dashboard/report', badge: '2' },
  ]},
]

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/customers': 'Customers',
  '/dashboard/transactions': 'Transaction History',
  '/dashboard/enrol': 'Enrol Customer',
  '/dashboard/savings': 'Record Saving',
  '/dashboard/calendar': 'Savings Calendar',
  '/dashboard/redeem': 'Redemption',
  '/dashboard/loan-request': 'Loan Request',
  '/dashboard/loan-disburse': 'Loan Disbursement',
  '/dashboard/loan-repay': 'Loan Repayment',
  '/dashboard/interest-rates': 'Interest Rates',
  '/dashboard/wallet': 'Wallet Funding',
  '/dashboard/commission': 'Commission',
  '/dashboard/withdraw': 'Withdraw Commission',
  '/dashboard/subagents': 'Sub-Agents',
  '/dashboard/chat': 'Support Chat',
  '/dashboard/settings': 'Settings',
  '/dashboard/report': 'Report Issue',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const [clock, setClock] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [chatUnread, setChatUnread] = useState(0)

  useEffect(() => {
    async function pollChat() {
      try {
        const res = await fetch('/api/agent/customer-chat')
        const data = await res.json()
        const total = (data.customers ?? []).reduce((s: number, c: any) => s + (c.unread ?? 0), 0)
        setChatUnread(total)
      } catch {}
    }
    pollChat()
    const iv = setInterval(pollChat, 10000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    const agent = session?.user as any
    const needsDocReview = agent?.docStatus && ['pending_approval', 'rejected'].includes(agent.docStatus)
    const documentsIncomplete = agent?.documentsComplete === false

    if (session && (documentsIncomplete || needsDocReview) && pathname !== '/dashboard/documents') {
      router.replace('/dashboard/documents')
    }
  }, [session, pathname, router])

  useEffect(() => {
    if (!session?.user) return
    const w = window as unknown as {
      __vochusCanBiometric?: boolean
      __vochusBiometricEnrolled?: boolean
      __vochusDeviceId?: string
      VochusBiometric?: { postMessage: (s: string) => void }
    }
    if (!w.__vochusCanBiometric || w.__vochusBiometricEnrolled || !w.VochusBiometric) return
    ;(async () => {
      try {
        const r = await fetch('/api/auth/biometric/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: w.__vochusDeviceId ?? '' }),
        })
        if (!r.ok) return
        const d = await r.json()
        w.VochusBiometric!.postMessage(JSON.stringify({ token: d.token, identifier: d.identifier }))
      } catch {}
    })()
  }, [session])

  const agent = session?.user as any
  const name: string = agent?.name ?? 'Agent'
  const agentId: string = agent?.agentId ?? '—'
  const location: string = agent?.location ?? '—'
  const walletBalance: number = agent?.walletBalance ?? 0
  const photoUrl: string | null = agent?.photoUrl ?? null
  const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)
  const avatarNode = photoUrl
    ? <img src={photoUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
    : initials

  const pageTitle = pageTitles[pathname] ?? 'Dashboard'

  useEffect(() => {
    function tick() {
      const now = new Date()
      const t = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      const d = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      setClock(`${t} · ${d}`)
    }
    tick()
    const id = setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="app-layout">
      {session?.user && <IdleTimeout onLogout={() => signOut({ callbackUrl: '/login' })} />}
      <div className={`sidebar-backdrop${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sb-logo">
          <Logo size={38} tile />
          <div>
            <div className="sb-brand-name">Vochus Easy Save</div>
            <div className="sb-brand-sub">Savings Platform</div>
          </div>
        </div>

        <div className="sb-agent">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
            <div className="sb-agent-av" style={{ overflow: 'hidden', padding: 0 }}>{avatarNode}</div>
            <div>
              <div className="sb-agent-name">{name}</div>
              <div className="sb-agent-id">{agentId} · {location}</div>
            </div>
          </div>
          <div className="sb-wallet-lbl">Agent Wallet</div>
          <div className="sb-wallet">₦{walletBalance.toLocaleString()}</div>
        </div>

        <nav className="sb-nav">
          {navItems.map(group => (
            <div key={group.section}>
              <div className="sb-section">{group.section}</div>
              {group.items.map(item => {
                const badge = item.href === '/dashboard/chat' && chatUnread > 0
                  ? String(chatUnread)
                  : item.badge
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item${pathname === item.href ? ' active' : ''}`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <div className="nav-ic">{item.icon}</div>
                    <span className="nav-label">{item.label}</span>
                    {badge && <span className="nav-badge">{badge}</span>}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sb-bottom">
          <button
            className="nav-item"
            onClick={() => signOut({ callbackUrl: '/login' })}
            style={{ color: 'rgba(255,255,255,.5)' }}
          >
            <div className="nav-ic" style={{ background: 'rgba(220,50,50,.15)' }}>🚪</div>
            <span className="nav-label" style={{ color: 'rgba(192,57,43,.8)' }}>Sign Out</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="mob-menu-btn" onClick={() => setSidebarOpen(o => !o)} aria-label="Menu">
            ☰
          </button>
          <div>
            <div className="topbar-title">{pageTitle}</div>
            <div className="topbar-breadcrumb">Vochus Easy Save › {pageTitle}</div>
          </div>
          <div className="topbar-spacer" />
          <div className="search-bar">
            <span>🔍</span>
            <input type="text" placeholder="Search customers, refs…" />
          </div>
          <div className="topbar-icon">
            <span>🔔</span>
            <div className="notif-dot" />
          </div>
          <div className="topbar-av" title={name} style={{ overflow: 'hidden', padding: 0 }}>{avatarNode}</div>
          <div className="time-badge">{clock}</div>
        </div>

        <div className="content-area">
          {children}
        </div>

        <BottomNav items={AGENT_NAV} />
      </main>

      <style>{`
        @media (max-width: 768px) {
          .content-area {
            padding-bottom: 80px;
          }
        }
      `}</style>
    </div>
  )
}
