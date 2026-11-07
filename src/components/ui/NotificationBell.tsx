'use client'
// The bell in the agent top bar and on the customer Home header. Shows how many notifications are new (1–9, then 9+).
// Refreshes when the screen opens, when the app comes back to the front, and every minute while open.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Icons } from '@/components/ui/icons'
import { badgeText } from '@/lib/notifications'
import { SEEN_EVENT } from '@/components/ui/NotificationList'

export default function NotificationBell({ countUrl, href }: { countUrl: string; href: string }) {
  const [count, setCount] = useState(0)
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(countUrl, { cache: 'no-store', credentials: 'same-origin' })
      if (!res.ok) return
      const d = await res.json() as { count?: number }
      setCount(typeof d.count === 'number' ? d.count : 0)
    } catch { /* offline: keep what we showed */ }
  }, [countUrl])

  useEffect(() => {
    refresh()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    const onSeen = () => setCount(0)
    window.addEventListener(SEEN_EVENT, onSeen)
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 60_000)
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener(SEEN_EVENT, onSeen); clearInterval(timer) }
  }, [refresh])

  const badge = badgeText(count)
  return (
    <Link href={href} className="ui-icon-btn nt-bell" aria-label={badge ? `Notifications, ${count} new` : 'Notifications'}>
      <Icons.bell size={24} aria-hidden="true" />
      {badge && <span className="nt-badge" aria-hidden="true">{badge}</span>}
    </Link>
  )
}
