'use client'

import { usePathname } from 'next/navigation'
import IdleTimeout from './IdleTimeout'

// The layout wraps these too, but nobody is signed in on them, so there is no session to time out.
const SIGNED_OUT_PATHS = ['/customer/login', '/customer/enroll', '/customer/forgot-password', '/customer/unlock']

export default function CustomerIdleTimeout() {
  const pathname = usePathname() ?? ''
  if (SIGNED_OUT_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))) return null
  return (
    <IdleTimeout
      onLogout={async () => {
        try {
          await fetch('/api/customer/auth/login', { method: 'DELETE' })
        } catch {}
        window.location.href = '/customer/login'
      }}
    />
  )
}
