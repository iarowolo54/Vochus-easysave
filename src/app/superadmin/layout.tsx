'use client'

import { SessionProvider, useSession, signOut } from 'next-auth/react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import './admin.css'
import Logo from '@/components/Logo'

const navGroups = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', icon: '⬛', href: '/superadmin' },
    ],
  },
  {
    label: 'Agent Management',
    items: [
      { label: 'All Agents', icon: '🤝', href: '/superadmin/agents' },
      { label: 'Agent Wallets', icon: '💼', href: '/superadmin/agent-wallets' },
      { label: 'Commission', icon: '🏅', href: '/superadmin/commission' },
      { label: 'Rewards', icon: '🎁', href: '/superadmin/rewards' },
      { label: 'Agent Withdrawals', icon: '💸', href: '/superadmin/agent-withdrawals' },
    ],
  },
  {
    label: 'Customer Operations',
    items: [
      { label: 'All Customers', icon: '👥', href: '/superadmin/customers' },
      { label: 'Savings Monitor', icon: '💰', href: '/superadmin/savings-monitor' },
    ],
  },
  {
    label: 'Loan Management',
    items: [
      { label: 'Loan Requests', icon: '🏦', href: '/superadmin/loan-requests', badgeKey: 'pendingLoans' },
      { label: 'Disbursements', icon: '💸', href: '/superadmin/loan-disburse' },
      { label: 'Repayments', icon: '🔄', href: '/superadmin/loan-repay' },
      { label: 'Loan Calculator', icon: '🧮', href: '/superadmin/loan-calculator' },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Platform Treasury', icon: '🏛️', href: '/superadmin/treasury' },
      { label: 'Redemptions', icon: '🎯', href: '/superadmin/early-redemption' },
      { label: 'Wallet Accounts', icon: '👛', href: '/superadmin/wallet-accounts' },
      { label: 'Transaction History', icon: '🧾', href: '/superadmin/transactions' },
      { label: 'Generate Cards', icon: '🖨️', href: '/superadmin/cards/generate' },
      { label: 'Gift Card Editor', icon: '🎴', href: '/superadmin/cards/gift-editor' },
      { label: 'Card Management', icon: '💳', href: '/superadmin/cards' },
      { label: 'Staff & Privileges', icon: '🔐', href: '/superadmin/staff' },
      { label: 'Device Registry', icon: '📱', href: '/superadmin/devices' },
      { label: 'Audit Log', icon: '🔍', href: '/superadmin/audit' },
      { label: 'Reports', icon: '📊', href: '/superadmin/reports' },
    ],
  },
]

const pageTitles: Record<string, string> = {
  '/superadmin': 'Dashboard',
  '/superadmin/agents': 'All Agents',
  '/superadmin/agent-wallets': 'Agent Wallets',
  '/superadmin/treasury': 'Platform Treasury',
  '/superadmin/commission': 'Commission',
  '/superadmin/rewards': 'Reward Promos',
  '/superadmin/agent-withdrawals': 'Agent Withdrawals',
  '/superadmin/customers': 'All Customers',
  '/superadmin/devices': 'Device Registry',
  '/superadmin/savings-monitor': 'Savings Monitor',
  '/superadmin/redemptions': 'Redemptions',
  '/superadmin/early-redemption': 'Redemptions',
  '/superadmin/loan-requests': 'Loan Requests',
  '/superadmin/loan-disburse': 'Disbursements',
  '/superadmin/loan-repay': 'Repayments',
  '/superadmin/transactions': 'Transaction History',
  '/superadmin/audit': 'Audit Log',
  '/superadmin/reports': 'Reports',
  '/superadmin/staff': 'Staff & Privileges',
  '/superadmin/loan-calculator': 'Loan Calculator',
  '/superadmin/wallet-accounts': 'Wallet Accounts',
  '/superadmin/cards': 'Card Management',
  '/superadmin/cards/generate': 'Generate Cards',
  '/superadmin/cards/gift-editor': 'Gift Card Editor',
}

function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const [pendingLoans, setPendingLoans] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const isLoginPage = pathname === '/superadmin/login'

  useEffect(() => {
    if (!isLoginPage && status === 'unauthenticated') {
      router.replace('/superadmin/login')
    }
  }, [status, router, isLoginPage])

  useEffect(() => {
    if (status === 'authenticated') {
      fetch('/api/admin/stats')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setPendingLoans(d.pendingLoans ?? 0) })
        .catch(() => {})
    }
  }, [status])

  if (isLoginPage) {
    return <>{children}</>
  }

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'IBM Plex Sans, sans-serif', color: '#8aaa94' }}>
        Loading…
      </div>
    )
  }

  if (status === 'unauthenticated') return null

  const admin = session?.user as any
  const name: string = admin?.name ?? 'Admin'
  const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
  const pageTitle = pageTitles[pathname] ?? 'Admin'

  return (
    <div className="admin-root">
      <div className={`a-backdrop${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`a-sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="a-sb-header">
          <Logo size={40} tile />
          <div className="a-sb-brand">
            <span className="name">Vochus Easy Save</span>
            <span className="sub">Super Admin</span>
          </div>
        </div>

        <div className="a-sb-admin">
          <div className="a-sb-admin-av">{initials}</div>
          <div>
            <div className="a-name">{name}</div>
            <div className="a-role">Super Administrator</div>
          </div>
        </div>

        <nav className="a-nav">
          {navGroups.map(group => (
            <div key={group.label}>
              <div className="a-nav-grp">{group.label}</div>
              {group.items.map(item => {
                const badge = (item as any).badgeKey === 'pendingLoans' ? pendingLoans : 0
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`a-nav-item${pathname === item.href ? ' active' : ''}`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <span className="ni-ic">{item.icon}</span>
                    {item.label}
                    {badge > 0 && <span className="ni-badge amber">{badge}</span>}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="a-sb-bottom">
          <button
            className="a-btn-signout"
            onClick={() => signOut({ callbackUrl: '/superadmin/login' })}
          >
            🚪 Sign Out
          </button>
        </div>
      </aside>

      <main className="a-main">
        <div className="a-topbar">
          <button className="a-mob-menu" onClick={() => setSidebarOpen(o => !o)} aria-label="Menu">☰</button>
          <div className="a-topbar-title">{pageTitle}</div>
          <div className="a-topbar-search">
            <span style={{ color: 'var(--text3)' }}>🔍</span>
            <input type="text" placeholder="Search…" />
          </div>
          <div className="a-icon-btn">
            🔔
            <div className="a-notif-dot" />
          </div>
          <div className="a-icon-btn">⚙️</div>
          <div className="a-topbar-av" title={name}>{initials}</div>
        </div>

        <div className="a-content">
          {children}
        </div>
      </main>
    </div>
  )
}

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath="/api/admin-auth">
      <AdminLayoutInner>{children}</AdminLayoutInner>
    </SessionProvider>
  )
}
