'use client'
import { useEffect } from 'react'
import LogoLoader from '@/components/ui/LogoLoader'
import { SPLASH_KEY } from '@/lib/splash'

// Opening screen: the animated logo, once per app launch (per browser session).
// The boot script (lib/splash.ts, inlined by the root layout) adds `ves-splash` to <html> before first paint when it hasn't
// been shown yet, so the page never flashes underneath. This component only decides when to leave.

const MIN_MS = 1200   // intro + one rise of the notes
const MAX_MS = 3000   // never hold people up longer than this
const FADE_MS = 300

export default function Splash() {
  useEffect(() => {
    const html = document.documentElement
    if (!html.classList.contains('ves-splash')) return
    try { sessionStorage.setItem(SPLASH_KEY, '1') } catch {}

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const started = performance.now()
    const min = reduced ? 500 : MIN_MS
    let done = false
    const timers: number[] = []

    function leave() {
      if (done) return
      done = true
      const wait = Math.max(0, min - (performance.now() - started))
      timers.push(window.setTimeout(() => {
        html.classList.add('ves-splash-out')
        timers.push(window.setTimeout(() => html.classList.remove('ves-splash', 'ves-splash-out'), FADE_MS))
      }, wait))
    }

    if (document.readyState === 'complete') leave()
    else window.addEventListener('load', leave, { once: true })
    timers.push(window.setTimeout(leave, MAX_MS))

    return () => {
      window.removeEventListener('load', leave)
      timers.forEach(clearTimeout)
    }
  }, [])

  return (
    <div className="ves-splash-screen" aria-hidden="true">
      <LogoLoader size={104} label="Opening Vochus Easy Save" />
      <p className="ves-splash-name">Vochus Easy Save</p>
    </div>
  )
}
