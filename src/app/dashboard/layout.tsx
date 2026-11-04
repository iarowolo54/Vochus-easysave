'use client'

import { phoneSettingsMode, shouldAutoEnrollFingerprint, type PhoneFlags } from '@/lib/phone-settings'
import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { leaveEndedSession, sessionHasEnded } from '@/lib/session-ended'
import BottomNav from '@/components/BottomNav'
import { AGENT_NAV } from '@/components/nav-items'
import IdleTimeout from '@/components/IdleTimeout'
import SessionKeepAlive from '@/components/SessionKeepAlive'
import Logo from '@/components/Logo'
import { Icons, type IconName } from '@/components/ui/icons'
import { displayName, formatNaira } from '@/lib/format'

const navItems: { section: string; items: { label: string; icon: IconName; href: string }[] }[] = [
  { section: 'Main', items: [
    { label: 'Home', icon: 'home', href: '/dashboard' },
    { label: 'Customers', icon: 'customers', href: '/dashboard/customers' },
    { label: 'Transactions', icon: 'history', href: '/dashboard/transactions' },
  ]},
  { section: 'Daily work', items: [
    { label: 'Record saving', icon: 'plan', href: '/dashboard/savings' },
    { label: 'Enrol customer', icon: 'enrol', href: '/dashboard/enrol' },
    { label: 'Savings calendar', icon: 'calendar', href: '/dashboard/calendar' },
    { label: 'Collections', icon: 'collect', href: '/dashboard/redeem' },
    { label: 'Cards', icon: 'card', href: '/dashboard/cards' },
  ]},
  { section: 'Loans', items: [
    { label: 'Loan request', icon: 'loan', href: '/dashboard/loan-request' },
    { label: 'Disburse loan', icon: 'withdraw', href: '/dashboard/loan-disburse' },
    { label: 'Loan repayment', icon: 'repay', href: '/dashboard/loan-repay' },
    { label: 'Interest rates', icon: 'rate', href: '/dashboard/interest-rates' },
  ]},
  { section: 'Money', items: [
    { label: 'Add money to wallet', icon: 'wallet', href: '/dashboard/wallet' },
    { label: 'Commission', icon: 'commission', href: '/dashboard/commission' },
    { label: 'Withdraw', icon: 'withdraw', href: '/dashboard/withdraw' },
    { label: 'Sub-agents', icon: 'team', href: '/dashboard/subagents' },
  ]},
  { section: 'Account', items: [
    { label: 'Customer chat', icon: 'chat', href: '/dashboard/chat' },
    { label: 'Settings', icon: 'settings', href: '/dashboard/settings' },
    { label: 'Report an issue', icon: 'report', href: '/dashboard/report' },
  ]},
]

const pageTitles: Record<string, string> = {
  '/dashboard': 'Home',
  '/dashboard/customers': 'Customers',
  '/dashboard/transactions': 'Transactions',
  '/dashboard/enrol': 'Enrol customer',
  '/dashboard/savings': 'Record saving',
  '/dashboard/calendar': 'Savings calendar',
  '/dashboard/redeem': 'Collections',
  '/dashboard/loan-request': 'Loan request',
  '/dashboard/loan-disburse': 'Disburse loan',
  '/dashboard/loan-repay': 'Loan repayment',
  '/dashboard/interest-rates': 'Interest rates',
  '/dashboard/wallet': 'Add money to wallet',
  '/dashboard/commission': 'Commission',
  '/dashboard/withdraw': 'Withdraw commission',
  '/dashboard/subagents': 'Sub-agents',
  '/dashboard/chat': 'Customer chat',
  '/dashboard/settings': 'Settings',
  '/dashboard/report': 'Report an issue',
  '/dashboard/documents': 'Documents',
  '/dashboard/cards': 'Cards',
  '/dashboard/add-plan': 'Add a plan',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status: sessionStatus } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [chatUnread, setChatUnread] = useState(0)
  const [canOpenAppSettings, setCanOpenAppSettings] = useState(false)
  const [ended, setEnded] = useState(false)
  const leaving = useRef(false)

  // The server ended this session (suspended, password changed, past the cap). Every API call now returns 401,
  // so send the agent to login instead of leaving a dashboard that can't load anything.
  const sessionEnded = useCallback(() => {
    setEnded(true)
    if (leaving.current) return
    leaving.current = true
    leaveEndedSession(
      () => signOut({ callbackUrl: '/login?ended=1' }),
      () => window.location.assign('/login?ended=1'),
    )
  }, [])

  const sessionCleared = sessionStatus === 'authenticated' && !session?.user
  useEffect(() => {
    if (sessionCleared) sessionEnded()
  }, [sessionCleared, sessionEnded])

  // Only the agent app has a printer/fingerprint sheet; older installs don't announce it.
  useEffect(() => {
    // The newer app has its printer and fingerprint controls on the Settings page, so only older apps keep the menu item.
    const check = () => setCanOpenAppSettings(phoneSettingsMode(window as unknown as PhoneFlags) === 'legacy')
    check()
    window.addEventListener('vochus:flags-ready', check)
    return () => window.removeEventListener('vochus:flags-ready', check)
  }, [])

  function openAppSettings() {
    setSidebarOpen(false)
    ;(window as unknown as { VochusAppSettings?: { postMessage: (s: string) => void } }).VochusAppSettings?.postMessage('')
  }

  useEffect(() => {
    async function pollChat() {
      try {
        const res = await fetch('/api/agent/customer-chat')
        // One 401 can be a busy database, so ask before signing out an agent who is fine.
        if (res.status === 401) {
          if (await sessionHasEnded()) sessionEnded()
          return
        }
        const data = await res.json()
        const total = (data.customers ?? []).reduce((s: number, c: any) => s + (c.unread ?? 0), 0)
        setChatUnread(total)
      } catch {}
    }
    pollChat()
    const iv = setInterval(pollChat, 10000)
    return () => clearInterval(iv)
  }, [sessionEnded])

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
    const w = window as unknown as PhoneFlags & {
      __vochusDeviceId?: string
      VochusBiometric?: { postMessage: (s: string) => void }
    }
    // Older apps switch fingerprint on by themselves; the newer app waits for the Enable button on the Settings page.
    if (!shouldAutoEnrollFingerprint(w) || !w.VochusBiometric) return
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
  const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
  const allHrefs = navItems.flatMap(g => g.items.map(i => i.href))
  // Pages reached from another one (not in the menu) highlight where they belong.
  const navPath = pathname.startsWith('/dashboard/add-plan') ? '/dashboard/customers' : pathname
  const activeHref = allHrefs
    .filter(h => navPath === h || navPath.startsWith(h + '/'))
    .sort((a, b) => b.length - a.length)[0]
  const avatarNode = photoUrl
    ? <img src={photoUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
    : initials

  const pageTitle = pageTitles[pathname]
    ?? (pathname.startsWith('/dashboard/transactions/') ? 'Receipt' : pathname.startsWith('/dashboard/cards/') ? 'Card' : 'Home')

  // Close the mobile menu with Escape, and whenever the page changes.
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])
  useEffect(() => { setSidebarOpen(false) }, [pathname])


  if (ended || sessionCleared) {
    return (
      <div className="ui-screen ui-screen--center" role="status">
        <div className="ui-empty">
          <span className="ui-spinner" aria-hidden="true" />
          <p className="ui-empty-title ui-gap-top">Signing you out…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="ag-shell">
      <SessionKeepAlive />
      {session?.user && <IdleTimeout onLogout={() => signOut({ callbackUrl: '/login' })} />}
      <div className={`ag-backdrop${sidebarOpen ? ' is-open' : ''}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      <aside className={`ag-sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Main menu">
        <div className="ag-brand">
          <Logo size={32} />
          <span>Vochus Easy Save</span>
          <button type="button" className="ui-icon-btn ui-icon-btn--soft ag-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <Icons.close size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="ag-agent">
          <span className="ui-avatar" aria-hidden="true">{avatarNode}</span>
          <span className="ag-agent-main">
            <span className="ag-agent-name">{displayName(name)}</span>
            <span className="ag-agent-sub">{agentId}{location !== '—' ? ` · ${location}` : ''}</span>
          </span>
        </div>
        <Link href="/dashboard/wallet" className="ag-wallet">
          <span className="ui-row-sub">Wallet</span>
          <span className="ui-amount ag-wallet-amount">{formatNaira(walletBalance)}</span>
        </Link>

        <nav className="ag-nav">
          {navItems.map(group => (
            <div key={group.section} className="ag-nav-group">
              <p className="ag-nav-section">{group.section}</p>
              {group.items.map(item => {
                const Icon = Icons[item.icon]
                const badge = item.href === '/dashboard/chat' && chatUnread > 0 ? chatUnread : 0
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="ag-nav-item"
                    aria-current={item.href === activeHref ? 'page' : undefined}
                  >
                    <Icon size={20} aria-hidden="true" />
                    <span>{item.label}</span>
                    {badge > 0 && <span className="ag-badge" aria-label={`${badge} unread`}>{badge}</span>}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {canOpenAppSettings && (
          <button type="button" className="ag-nav-item" onClick={openAppSettings}>
            <Icons.print size={20} aria-hidden="true" />
            <span>Printer &amp; fingerprint</span>
          </button>
        )}
        <button type="button" className="ag-nav-item ag-signout" onClick={() => signOut({ callbackUrl: '/login' })}>
          <Icons.logout size={20} aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </aside>

      <div className="ag-main">
        <header className="ag-topbar">
          <button type="button" className="ui-icon-btn ag-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu" aria-expanded={sidebarOpen}>
            <Icons.menu size={22} aria-hidden="true" />
          </button>
          <h1 className="ag-title">{pageTitle}</h1>
          <Link href="/dashboard/settings" className="ui-avatar ag-topbar-av" aria-label="Your settings">{avatarNode}</Link>
        </header>

        <div className="content-area ag-content">
          {children}
        </div>

        <BottomNav items={AGENT_NAV} onMore={() => setSidebarOpen(true)} badges={{ more: chatUnread }} />
      </div>
    </div>
  )
}
