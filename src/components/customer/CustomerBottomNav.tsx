'use client'
import { useEffect, useState } from 'react'
import BottomNav from '@/components/BottomNav'
import { CUSTOMER_NAV } from '@/components/nav-items'

const POLL_MS = 45_000

/**
 * The customer's bottom nav, with the Chat tab showing unread messages so a receipt or reply doesn't go unseen.
 * The count comes from a read-only endpoint. Polling it cannot keep a session alive: only /api/session/ping
 * extends the idle window. A failed or signed-out request just leaves the badge off.
 */
export default function CustomerBottomNav() {
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    let stopped = false

    async function load() {
      if (stopped || document.visibilityState === 'hidden') return
      try {
        const res = await fetch('/api/customer/chat/unread', { cache: 'no-store', credentials: 'same-origin' })
        if (res.status === 401) { stopped = true; setUnread(0); return }
        if (!res.ok) return
        const data = (await res.json()) as { count?: unknown }
        if (!stopped) setUnread(typeof data.count === 'number' && data.count > 0 ? Math.floor(data.count) : 0)
      } catch {
        // Offline or a hiccup: keep whatever the badge showed.
      }
    }

    load()
    const timer = setInterval(load, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return <BottomNav items={CUSTOMER_NAV} badges={{ chat: unread }} />
}
