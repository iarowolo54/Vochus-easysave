'use client'

import { useEffect } from 'react'

// Minimum spacing between heartbeat pings.
export const MIN_GAP = 90_000

export function shouldPing(lastPingMs: number | null, nowMs: number, minGapMs: number): boolean {
  return lastPingMs === null || nowMs - lastPingMs >= minGapMs
}

/**
 * Slides the server-side idle window while the user is genuinely interacting.
 * Only real input events trigger a ping (no timer), so a walked-away user
 * still idles out.
 */
export default function SessionKeepAlive() {
  useEffect(() => {
    let last: number | null = null
    const onActivity = () => {
      const now = Date.now()
      if (!shouldPing(last, now, MIN_GAP)) return
      last = now
      fetch('/api/session/ping', { credentials: 'same-origin' }).catch(() => {})
    }
    // Include scroll + mousemove so a user who is reading/scrolling (not
    // clicking) still counts as present. All passive; the 90s shouldPing
    // throttle keeps the ping rate low regardless of event frequency.
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'mousemove'] as const
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }))
    return () => events.forEach(e => window.removeEventListener(e, onActivity))
  }, [])
  return null
}
