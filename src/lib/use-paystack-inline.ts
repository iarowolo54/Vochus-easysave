'use client'
// Paystack's in-page card window (inline.js), used by agent wallet top-ups when super admin has agents on Card.
// Loaded only when it is going to be used.
import { useEffect, useState } from 'react'

declare global {
  interface Window {
    PaystackPop?: {
      setup(opts: {
        key: string; email: string; amount: number; ref: string; metadata?: Record<string, unknown>
        callback: (resp: { reference: string }) => void; onClose: () => void
      }): { openIframe(): void }
    }
  }
}

export function usePaystackInline(enabled: boolean): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!enabled) return
    if (window.PaystackPop) { setReady(true); return }
    const s = document.createElement('script')
    s.src = 'https://js.paystack.co/v1/inline.js'
    s.async = true
    s.onload = () => setReady(true)
    document.head.appendChild(s)
  }, [enabled])
  return ready
}

/** The public key the card window needs. Missing = card top-ups can't open; the screen says so. */
export const PAYSTACK_PUBLIC_KEY: string | undefined = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || undefined
