'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Logo from './Logo'

type Variant = 'customer' | 'agent'

const APK: Record<Variant, { href: string; label: string }> = {
  customer: { href: '/downloads/easysave-customer.apk', label: 'Vochus Easy Save' },
  agent:    { href: '/downloads/easysave-agent.apk',    label: 'Vochus Easy Save Agent' },
}

export default function DownloadAppBanner({ variant: forced }: { variant?: Variant } = {}) {
  const pathname = usePathname() || ''
  const variant: Variant = forced ?? (pathname.startsWith('/customer') ? 'customer' : 'agent')
  const [show, setShow] = useState(false)

  const [isAndroid, setIsAndroid] = useState(false)

  useEffect(() => {
    if (pathname.startsWith('/superadmin') || pathname.startsWith('/downloads')) return
    const dismissed = localStorage.getItem(`apk-banner-dismissed-${variant}`) === '1'
    if (dismissed) return
    setIsAndroid(/Android/i.test(navigator.userAgent))
    const check = () => {
      const inApp = !!(window as unknown as { __vochusApp?: string }).__vochusApp
      if (!inApp) setShow(true)
    }
    const onFlags = () => {
      const inApp = !!(window as unknown as { __vochusApp?: string }).__vochusApp
      if (inApp) setShow(false)
    }
    check()
    window.addEventListener('vochus:flags-ready', onFlags)
    return () => window.removeEventListener('vochus:flags-ready', onFlags)
  }, [variant, pathname])

  if (!show) return null
  const { href, label } = APK[variant]
  const actionHref = isAndroid ? href : '/downloads'
  const actionLabel = isAndroid ? 'Install' : 'View'

  return (
    <div style={{
      position: 'relative', zIndex: 250,
      background: 'var(--ui-brand-ink)', color: '#fff',
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
      fontFamily: 'Inter, sans-serif', fontSize: 13,
      boxShadow: '0 2px 8px rgba(0,0,0,.15)',
    }}>
      <Logo size={36} tile />
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
        <div style={{ fontWeight: 800 }}>Get the {label} app</div>
        <div style={{ opacity: .85, fontSize: 12 }}>Faster access, native experience.</div>
      </div>
      <a href={actionHref} {...(isAndroid ? { download: true } : {})} style={{
        background: '#fff', color: 'var(--ui-brand-ink)', padding: '7px 12px',
        borderRadius: 8, textDecoration: 'none', fontWeight: 800, fontSize: 12,
        whiteSpace: 'nowrap',
      }}>{actionLabel}</a>
      <button
        onClick={() => { localStorage.setItem(`apk-banner-dismissed-${variant}`, '1'); setShow(false) }}
        aria-label="Dismiss"
        style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1, opacity: .8 }}
      >×</button>
    </div>
  )
}
