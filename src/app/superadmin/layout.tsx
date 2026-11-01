'use client'

import { SessionProvider } from 'next-auth/react'
import AdminShell from './_components/AdminShell'

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  // Do NOT add refetchInterval to the SessionProvider below: the
  // /api/admin-auth/session endpoint is excluded from the session-expiry proxy
  // and rolls the cookie's exp, so a background poll would slide the admin
  // session without user activity and defeat the idle timeout. Idle is driven
  // by SessionKeepAlive (real input).
  return (
    <SessionProvider basePath="/api/admin-auth">
      <AdminShell>{children}</AdminShell>
    </SessionProvider>
  )
}
