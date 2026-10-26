'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icons } from './ui/icons'
import type { NavItem } from './nav-items'

interface BottomNavProps {
  items: NavItem[]
}

export default function BottomNav({ items }: BottomNavProps) {
  const pathname = usePathname()
  // Longest matching href wins, so /dashboard doesn't stay lit on /dashboard/customers.
  const active = items
    .filter(i => pathname === i.href || pathname.startsWith(i.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]

  return (
    <nav className="ui-bottom-nav" aria-label="Main">
      {items.map(item => {
        const isActive = item === active
        const Icon = Icons[item.icon]
        return (
          <Link
            key={item.key}
            href={item.href}
            className="ui-bottom-nav-item"
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon size={22} strokeWidth={isActive ? 2.25 : 1.75} aria-hidden="true" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
