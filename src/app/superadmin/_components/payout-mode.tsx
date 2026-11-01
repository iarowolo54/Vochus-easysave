'use client'

import { useEffect, useState } from 'react'
import { Icons } from '@/components/ui/icons'

export type PayoutModeValue = 'auto' | 'manual'
export interface PayoutModes { agent: PayoutModeValue; customer: PayoutModeValue }

const isMode = (v: unknown): v is PayoutModeValue => v === 'auto' || v === 'manual'

/** Parse the `{ mode }` payload of /api/admin/payout-mode; null if malformed. */
export function parsePayoutModes(body: unknown): PayoutModes | null {
  const m = body && typeof body === 'object' ? (body as { mode?: unknown }).mode : null
  if (!m || typeof m !== 'object') return null
  const { agent, customer } = m as { agent?: unknown; customer?: unknown }
  return isMode(agent) && isMode(customer) ? { agent, customer } : null
}

/**
 * Current payout mode for the payout pages. Stays null while loading or if the
 * fetch fails, which every caller treats as Automatic (the page is unchanged).
 */
export function usePayoutMode(): PayoutModes | null {
  const [modes, setModes] = useState<PayoutModes | null>(null)
  useEffect(() => {
    let live = true
    fetch('/api/admin/payout-mode')
      .then(r => (r.ok ? r.json() : null))
      .then(b => { if (live) setModes(parsePayoutModes(b)) })
      .catch(() => {})
    return () => { live = false }
  }, [])
  return modes
}

export function ManualModeBanner({ children }: { children?: React.ReactNode }) {
  return (
    <div className="a-alert a-alert-a" role="status">
      <Icons.error size={18} aria-hidden="true" />
      <div>
        <strong>Manual mode.</strong> Paystack is bypassed. You pay recipients out-of-band and mark payouts as paid.
        {children}
      </div>
    </div>
  )
}
