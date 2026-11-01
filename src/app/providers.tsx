'use client'

import { SessionProvider } from 'next-auth/react'

export default function Providers({ children }: { children: React.ReactNode }) {
  // Do NOT add refetchInterval here: the /api/auth/session endpoint is excluded
  // from the session-expiry proxy and rolls the cookie's exp, so a background
  // poll would slide the agent session without user activity and defeat the idle
  // timeout. Idle is driven by SessionKeepAlive (real input).
  return <SessionProvider>{children}</SessionProvider>
}
