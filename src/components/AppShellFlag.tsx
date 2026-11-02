'use client'

import { useEffect } from 'react'

/**
 * Marks <html> when the page runs inside the Flutter apps. Their SafeArea already keeps the WebView
 * clear of the system bars, but the WebView still reports those insets through env(), so CSS would
 * count them twice. Globals use --ui-safe-* and zero them for this attribute.
 */
export default function AppShellFlag() {
  useEffect(() => {
    const check = () => {
      if ((window as unknown as { __vochusApp?: string }).__vochusApp) document.documentElement.dataset.vochusShell = ''
    }
    check()
    window.addEventListener('vochus:flags-ready', check)
    return () => window.removeEventListener('vochus:flags-ready', check)
  }, [])
  return null
}
