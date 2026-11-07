'use client'
import { useEffect, useState } from 'react'
import { DEFAULT_FUNDING_MODE, type FundingMode } from '@/lib/funding-mode'

/** The top-up method in force (super admin, Payouts & top-ups). Bank transfer until the server says otherwise. */
export function useFundingMode(): FundingMode {
  const [mode, setMode] = useState<FundingMode>(DEFAULT_FUNDING_MODE)
  useEffect(() => {
    let off = false
    fetch('/api/funding-mode', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { mode?: FundingMode } | null) => { if (!off && d?.mode) setMode(d.mode) })
      .catch(() => {})
    return () => { off = true }
  }, [])
  return mode
}
