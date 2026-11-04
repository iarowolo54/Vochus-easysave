'use client'

import { useEffect, useRef } from 'react'
import { IN_APP_IDLE_SECONDS } from '@/lib/session-policy'

const IDLE_MS = IN_APP_IDLE_SECONDS * 1000
const EVENTS = ['touchstart', 'touchend', 'click', 'keydown', 'scroll', 'mousemove']

// Signs out silently (no warning) after IN_APP_IDLE_SECONDS without activity. Only runs
// inside the mobile app, which announces itself via __vochusApp.
export default function IdleSignOut({ onLogout }: { onLogout: () => void }) {
  const logoutRef = useRef(onLogout)
  logoutRef.current = onLogout

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let enabled = false
    const arm = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => logoutRef.current(), IDLE_MS)
    }
    // __vochusApp can land after mount, so also switch on when the app announces flags.
    const enable = () => {
      if (enabled || !(window as unknown as { __vochusApp?: string }).__vochusApp) return
      enabled = true
      EVENTS.forEach(e => window.addEventListener(e, arm, { passive: true }))
      arm()
    }
    enable()
    window.addEventListener('vochus:flags-ready', enable)
    return () => {
      window.removeEventListener('vochus:flags-ready', enable)
      EVENTS.forEach(e => window.removeEventListener(e, arm))
      if (timer) clearTimeout(timer)
    }
  }, [])

  return null
}
