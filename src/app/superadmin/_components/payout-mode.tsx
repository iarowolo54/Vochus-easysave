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

export interface PayoutModeState {
  /** The current modes, or null while loading / on failure (callers treat null as Automatic). */
  modes: PayoutModes | null
  /** True when the mode couldn't be loaded — the page can't trust its Auto/Manual labels. */
  error: boolean
  /** Re-fetch the mode (e.g. from a Retry button). */
  reload: () => void
}

/**
 * Current payout mode for the payout pages. `modes` is null while loading or on
 * failure (callers treat null as Automatic, and the server still enforces the real
 * mode on approve); `error` lets a page warn that its labels may be stale.
 */
export function usePayoutMode(): PayoutModeState {
  const [modes, setModes] = useState<PayoutModes | null>(null)
  const [error, setError] = useState(false)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let live = true
    setError(false)
    fetch('/api/admin/payout-mode')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('request failed'))))
      .then(b => {
        if (!live) return
        const m = parsePayoutModes(b)
        if (m) setModes(m)
        else setError(true)
      })
      .catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [nonce])
  return { modes, error, reload: () => setNonce(n => n + 1) }
}

export function PayoutModeError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="a-alert a-alert-a" role="alert">
      <Icons.error size={18} aria-hidden="true" />
      <div>
        <strong>Couldn’t check payout mode.</strong> The buttons below may be wrong — the server still enforces the real mode when you approve.{' '}
        <button type="button" className="btn btn-sm btn-outline" onClick={onRetry}>Retry</button>
      </div>
    </div>
  )
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
