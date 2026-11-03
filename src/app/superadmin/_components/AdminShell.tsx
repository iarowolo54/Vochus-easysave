'use client'

import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import '../admin.css'
import Logo from '@/components/Logo'
import SessionKeepAlive from '@/components/SessionKeepAlive'
import { Icons, type IconName } from '@/components/ui/icons'
import { AREA_LABELS, type Area } from '@/lib/permissions'
import { useMyAccess, hasMoneyArea } from './useMyAccess'
import NoAccess from './NoAccess'
import { ChangePasswordModal, SetPinModal } from './SelfService'
import { useToast } from './admin-ui'

type NavItem = { label: string; icon: IconName; href: string; badge?: 'pendingLoans'; ownerOnly?: boolean }

// `area` gates a group for staff (cosmetic; the API guards enforce). No area = always shown.
const navGroups: { label: string; area?: Area; items: NavItem[] }[] = [
  {
    label: '',
    items: [{ label: 'Home', icon: 'home', href: '/superadmin' }],
  },
  {
    label: 'Agents',
    area: 'agents',
    items: [
      { label: 'All agents', icon: 'customers', href: '/superadmin/agents' },
      { label: 'Agent wallets', icon: 'wallet', href: '/superadmin/agent-wallets' },
      { label: 'Withdrawals', icon: 'withdraw', href: '/superadmin/agent-withdrawals' },
      { label: 'Commission', icon: 'commission', href: '/superadmin/commission' },
      { label: 'Rewards', icon: 'gift', href: '/superadmin/rewards' },
    ],
  },
  {
    label: 'Customers',
    area: 'customers',
    items: [
      { label: 'All customers', icon: 'plan', href: '/superadmin/customers' },
      { label: 'Savings monitor', icon: 'monitor', href: '/superadmin/savings-monitor' },
      { label: 'Redemptions', icon: 'redeem', href: '/superadmin/early-redemption' },
    ],
  },
  {
    label: 'Loans',
    area: 'loans',
    items: [
      { label: 'Loan requests', icon: 'loan', href: '/superadmin/loan-requests', badge: 'pendingLoans' },
      { label: 'Disbursements', icon: 'cash', href: '/superadmin/loan-disburse' },
      { label: 'Repayments', icon: 'repay', href: '/superadmin/loan-repay' },
      { label: 'Loan calculator', icon: 'calculator', href: '/superadmin/loan-calculator' },
    ],
  },
  {
    label: 'Money',
    area: 'money',
    items: [
      { label: 'Treasury', icon: 'treasury', href: '/superadmin/treasury' },
      { label: 'Wallet accounts', icon: 'deposit', href: '/superadmin/wallet-accounts' },
      { label: 'Transactions', icon: 'history', href: '/superadmin/transactions' },
      { label: 'Payout mode', icon: 'settings', href: '/superadmin/payout-mode' },
    ],
  },
  {
    label: 'Cards',
    area: 'cards',
    items: [
      { label: 'Card management', icon: 'card', href: '/superadmin/cards' },
      { label: 'Generate cards', icon: 'qr', href: '/superadmin/cards/generate' },
      { label: 'Gift card design', icon: 'design', href: '/superadmin/cards/gift-editor' },
    ],
  },
  {
    label: 'Oversight',
    area: 'oversight',
    items: [
      { label: 'Staff & access', icon: 'staff', href: '/superadmin/staff', ownerOnly: true },
      { label: 'Devices', icon: 'device', href: '/superadmin/devices' },
      { label: 'Audit log', icon: 'audit', href: '/superadmin/audit' },
      { label: 'Reports', icon: 'reports', href: '/superadmin/reports' },
    ],
  },
]

const allItems = navGroups.flatMap(g => g.items)

/** The nav item a path belongs to: the longest href it starts with (so /cards/generate isn't also /cards). */
function activeHref(pathname: string) {
  if (pathname === '/superadmin/redemptions') return '/superadmin/early-redemption'
  let best = '/superadmin'
  for (const { href } of allItems) {
    if ((pathname === href || pathname.startsWith(`${href}/`)) && href.length > best.length) best = href
  }
  return best
}

/** The area a path needs, from the nav group of its longest matching item. Unknown paths need none. */
function areaForPath(pathname: string): { area?: Area; ownerOnly?: boolean } {
  const href = activeHref(pathname)
  for (const g of navGroups) {
    const item = g.items.find(i => i.href === href)
    if (item) return { area: g.area, ownerOnly: item.ownerOnly }
  }
  return {}
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const [pendingLoans, setPendingLoans] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [modal, setModal] = useState<'password' | 'pin' | null>(null)
  const [toastNode, toast] = useToast()

  const isLoginPage = pathname === '/superadmin/login' || pathname === '/superadmin/accept-invite'

  const { state: me, reload: reloadMe } = useMyAccess(status === 'authenticated' && !isLoginPage)

  useEffect(() => {
    if (!isLoginPage && status === 'unauthenticated') router.replace('/superadmin/login')
  }, [status, router, isLoginPage])

  useEffect(() => {
    if (status !== 'authenticated') return
    fetch('/api/admin/stats')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setPendingLoans(d.pendingLoans ?? 0) })
      .catch(() => {})
  }, [status, pathname])

  useEffect(() => { setSidebarOpen(false); setMenuOpen(false) }, [pathname])

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [menuOpen])

  if (isLoginPage) return <>{children}</>

  if (status === 'loading') {
    return (
      <div className="admin-root admin-root--loading" aria-busy="true">
        <span className="ui-spinner" aria-hidden="true" />
        <span className="sr-only">Loading</span>
      </div>
    )
  }

  if (status === 'unauthenticated') return null

  const admin = session?.user as { name?: string | null; email?: string | null } | undefined
  const name = admin?.name ?? 'Admin'
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const current = activeHref(pathname)
  const currentLabel = allItems.find(i => i.href === current)?.label ?? 'Admin'
  const access = me.status === 'ready' ? me.access : null
  const isOwner = access?.role === 'superadmin'
  const can = (area?: Area) => !area || (!!access && (isOwner || access.areas.includes(area)))
  const visibleGroups = navGroups
    .filter(g => can(g.area))
    .map(g => ({ ...g, items: g.items.filter(i => !i.ownerOnly || isOwner) }))
    .filter(g => g.items.length > 0)
  const need = areaForPath(pathname)
  const blocked = me.status === 'ready' && ((need.ownerOnly && !isOwner) || !can(need.area))
  const canPin = !!access && hasMoneyArea(access.areas)
  const nudgePin = !!access && access.role === 'staff' && canPin && !access.hasApprovalPin
  const signOutNow = () => signOut({ callbackUrl: '/superadmin/login' })

  return (
    <div className="admin-root">
      <SessionKeepAlive />
      <div className={`a-backdrop${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      <aside className={`a-sidebar${sidebarOpen ? ' open' : ''}`} aria-label="Admin navigation">
        <div className="a-sb-header">
          <Link href="/superadmin" className="a-sb-brand">
            <Logo size={30} />
            <span className="a-sb-brand-text">
              <span className="name">Vochus Easy Save</span>
              <span className="sub">Admin</span>
            </span>
          </Link>
          <button type="button" className="a-sb-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <Icons.close size={20} aria-hidden="true" />
          </button>
        </div>

        <nav className="a-nav">
          {visibleGroups.map(group => (
            <div key={group.label || 'top'} className="a-nav-group">
              {group.label && <div className="a-nav-grp">{group.label}</div>}
              {group.items.map(item => {
                const Icon = Icons[item.icon]
                const badge = item.badge === 'pendingLoans' ? pendingLoans : 0
                const active = current === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`a-nav-item${active ? ' active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon size={18} aria-hidden="true" className="ni-ic" />
                    <span className="ni-label">{item.label}</span>
                    {badge > 0 && <span className="ni-badge" aria-label={`${badge} waiting`}>{badge}</span>}
                  </Link>
                )
              })}
            </div>
          ))}
          {me.status === 'error' && (
            <div className="a-nav-group">
              <button type="button" className="a-nav-item" onClick={reloadMe}>
                <Icons.retry size={18} aria-hidden="true" className="ni-ic" />
                <span className="ni-label">Couldn’t load your menu. Retry</span>
              </button>
            </div>
          )}
        </nav>

        <div className="a-sb-bottom">
          <button type="button" className="a-btn-signout" onClick={signOutNow}>
            <Icons.logout size={18} aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>

      <main className="a-main">
        <header className="a-topbar">
          <button type="button" className="a-mob-menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu" aria-expanded={sidebarOpen}>
            <Icons.menu size={22} aria-hidden="true" />
          </button>
          <div className="a-topbar-title">{currentLabel}</div>
          <div className="a-account" ref={menuRef}>
            <button type="button" className="a-account-btn" onClick={() => setMenuOpen(o => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
              <span className="a-topbar-av" aria-hidden="true">{initials}</span>
              <span className="a-account-name">{name}</span>
              <Icons.expand size={16} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div className="a-account-menu" role="menu">
                <div className="a-account-who">
                  <strong>{name}</strong>
                  {admin?.email && <span>{admin.email}</span>}
                </div>
                {access && (
                  <>
                    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setModal('password') }}>
                      <Icons.settings size={16} aria-hidden="true" /> Change password
                    </button>
                    {canPin && (
                      <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setModal('pin') }}>
                        <Icons.locked size={16} aria-hidden="true" /> {access.hasApprovalPin ? 'Change approval PIN' : 'Set approval PIN'}
                      </button>
                    )}
                  </>
                )}
                <button type="button" role="menuitem" onClick={signOutNow}>
                  <Icons.logout size={16} aria-hidden="true" /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="a-content">
          {nudgePin && !blocked && (
            <div className="ov-attention" role="list" aria-label="Set up your approval PIN">
              <button type="button" className="ov-attention-item" role="listitem" onClick={() => setModal('pin')}>
                <span className="ov-attention-ic" aria-hidden="true"><Icons.locked size={18} /></span>
                <span className="ov-attention-text">Set an approval PIN so you can approve payouts and cash</span>
                <span className="ov-attention-cta">Set PIN <Icons.next size={16} aria-hidden="true" /></span>
              </button>
            </div>
          )}
          {me.status === 'loading' && pathname !== '/superadmin' ? (
            <div aria-busy="true"><div className="skel" style={{ width: 240, height: 30, marginBottom: 20 }} /><div className="card"><div className="skel" style={{ height: 220 }} /></div></div>
          ) : blocked ? (
            <NoAccess area={need.area ? AREA_LABELS[need.area] : undefined} />
          ) : children}
        </div>
      </main>

      {modal === 'password' && (
        <ChangePasswordModal onClose={() => setModal(null)} onDone={() => { setModal(null); toast('Password changed', 'success') }} />
      )}
      {modal === 'pin' && access && (
        <SetPinModal hasPin={access.hasApprovalPin} onClose={() => setModal(null)} onDone={() => { setModal(null); reloadMe(); toast('Approval PIN saved', 'success') }} />
      )}
      {toastNode}
    </div>
  )
}
