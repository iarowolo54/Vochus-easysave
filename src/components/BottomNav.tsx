'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icons } from './ui/icons'
import type { NavItem } from './nav-items'

interface BottomNavProps {
  items: NavItem[]
  /** Called by a `more` item (opens the full menu). */
  onMore?: () => void
  /** Unread counts by item key, shown as a dot with a number. */
  badges?: Record<string, number>
}

export default function BottomNav({ items, onMore, badges }: BottomNavProps) {
  const pathname = usePathname()
  // Longest matching href wins, so /dashboard doesn't stay lit on /dashboard/customers.
  const active = items
    .filter(i => !i.more && (pathname === i.href || pathname.startsWith(i.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0]

  return (
    <nav className="ui-bottom-nav" aria-label="Main">
      {items.map(item => {
        const isActive = item === active
        const Icon = Icons[item.icon]
        const badge = badges?.[item.key] ?? 0
        const content = (
          <>
            <span className={item.prominent ? 'ui-bottom-nav-fab' : 'ui-bottom-nav-icon'}>
              <Icon size={item.prominent ? 26 : 22} strokeWidth={isActive || item.prominent ? 2.25 : 1.75} aria-hidden="true" />
              {badge > 0 && <span className="ui-bottom-nav-badge">{badge > 9 ? '9+' : badge}</span>}
            </span>
            {item.label}
          </>
        )
        const cls = `ui-bottom-nav-item${item.prominent ? ' ui-bottom-nav-item--prominent' : ''}`
        if (item.more) {
          return (
            <button key={item.key} type="button" className={cls} onClick={onMore} aria-label={badge > 0 ? `${item.label}, ${badge} unread messages` : item.label}>
              {content}
            </button>
          )
        }
        return (
          <Link key={item.key} href={item.href} className={cls} aria-current={isActive ? 'page' : undefined} aria-label={badge > 0 ? `${item.label}, ${badge} unread messages` : undefined}>
            {content}
          </Link>
        )
      })}
    </nav>
  )
}
