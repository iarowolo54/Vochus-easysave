'use client'

import { SessionProvider } from 'next-auth/react'
import AdminShell from './_components/AdminShell'

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath="/api/admin-auth">
      <AdminShell>{children}</AdminShell>
    </SessionProvider>
  )
}
