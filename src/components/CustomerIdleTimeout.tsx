'use client'

import IdleTimeout from './IdleTimeout'

export default function CustomerIdleTimeout() {
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
