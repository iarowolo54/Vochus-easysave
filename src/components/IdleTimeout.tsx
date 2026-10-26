'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const IDLE_MS = 5 * 60 * 1000
const WARN_SEC = 30
const RING_CIRC = 2 * Math.PI * 34

export default function IdleTimeout({ onLogout }: { onLogout: () => void }) {
  const [warning, setWarning] = useState(false)
  const [secsLeft, setSecsLeft] = useState(WARN_SEC)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const enabled = useRef(false)

  const clearAll = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (tickTimer.current) clearInterval(tickTimer.current)
    idleTimer.current = null
    tickTimer.current = null
  }

  const logout = useCallback(() => {
    clearAll()
    setWarning(false)
    onLogout()
  }, [onLogout])

  const armIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      setSecsLeft(WARN_SEC)
      setWarning(true)
    }, IDLE_MS - WARN_SEC * 1000)
  }, [])

  const reset = useCallback(() => {
    if (!enabled.current) return
    if (warning) return
    armIdle()
  }, [warning, armIdle])

  const stillHere = () => {
    if (tickTimer.current) clearInterval(tickTimer.current)
    tickTimer.current = null
    setWarning(false)
    armIdle()
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!(window as unknown as { __vochusApp?: string }).__vochusApp) return

    enabled.current = true
    const events = ['touchstart', 'touchend', 'click', 'keydown', 'scroll', 'mousemove']
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))
    armIdle()
    return () => {
      enabled.current = false
      events.forEach(e => window.removeEventListener(e, reset))
      clearAll()
    }
  }, [reset, armIdle])

  useEffect(() => {
    if (!warning) return
    tickTimer.current = setInterval(() => {
      setSecsLeft(s => {
        if (s <= 1) {
          if (tickTimer.current) clearInterval(tickTimer.current)
          tickTimer.current = null
          logout()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => {
      if (tickTimer.current) clearInterval(tickTimer.current)
    }
  }, [warning, logout])

  if (!warning) return null

  const pct = (WARN_SEC - secsLeft) / WARN_SEC
  const dashOffset = (RING_CIRC * pct).toFixed(1)
  const isRed = secsLeft <= 10
  const color = isRed ? '#c0392b' : '#c8841a'

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 99000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 340, overflow: 'hidden', animation: 'idlePopIn .3s cubic-bezier(.34,1.56,.64,1) both' }}>
        <div style={{ background: 'linear-gradient(135deg,#7a3f00,#c8841a)', padding: '24px 20px 18px', textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>⏰</div>
          <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 18, fontWeight: 900, color: '#fff' }}>Still there?</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.7)', marginTop: 4 }}>Your session is about to expire</div>
        </div>
        <div style={{ padding: '22px 20px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: '#6b8070', marginBottom: 10, lineHeight: 1.5 }}>For your security, you will be signed out in</div>
          <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 52, fontWeight: 900, color, lineHeight: 1 }}>{secsLeft}</div>
          <div style={{ fontSize: 12, color: '#6b8070', marginTop: 4, marginBottom: 20 }}>seconds</div>
          <div style={{ width: 80, height: 80, margin: '0 auto 20px', position: 'relative' }}>
            <svg width={80} height={80} style={{ transform: 'rotate(-90deg)' }}>
              <circle cx={40} cy={40} r={34} fill="none" stroke="#eee" strokeWidth={6} />
              <circle cx={40} cy={40} r={34} fill="none" stroke={color} strokeWidth={6}
                strokeDasharray={RING_CIRC.toFixed(1)} strokeDashoffset={dashOffset}
                style={{ transition: 'stroke-dashoffset 1s linear' }} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color }}>{secsLeft}s</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 22 }}>
            <button onClick={stillHere} style={{ width: '100%', padding: 13, borderRadius: 100, border: 'none', background: 'linear-gradient(135deg,#f0a830,#c8841a)', color: '#fff', fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>✅ Yes, I&apos;m still here</button>
            <button onClick={logout} style={{ width: '100%', padding: 12, borderRadius: 100, border: '1.5px solid #d8e8dd', background: '#fff', color: '#6b8070', fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Sign Out Now</button>
          </div>
        </div>
      </div>
      <style>{`@keyframes idlePopIn { 0%{transform:scale(.9);opacity:0} 100%{transform:scale(1);opacity:1} }`}</style>
    </div>
  )
}
