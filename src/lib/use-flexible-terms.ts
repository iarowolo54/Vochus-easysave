'use client'
import { useEffect, useState } from 'react'
import { DEFAULT_FLEXIBLE_SETTINGS } from '@/lib/flexible-savings'

export interface FlexibleTerms { minTermMonths: number; minDeposit: number; cashCommissionPct: number; penaltyPct: number }

const DEFAULTS: FlexibleTerms = {
  minTermMonths: DEFAULT_FLEXIBLE_SETTINGS.minTermMonths, minDeposit: DEFAULT_FLEXIBLE_SETTINGS.minDeposit,
  cashCommissionPct: DEFAULT_FLEXIBLE_SETTINGS.cashCommissionPct, penaltyPct: DEFAULT_FLEXIBLE_SETTINGS.penaltyPct,
}

/** The flexible plan terms the screens describe. Starts on the defaults; the server checks again on save either way. */
export function useFlexibleTerms(): FlexibleTerms {
  const [terms, setTerms] = useState<FlexibleTerms>(DEFAULTS)
  useEffect(() => {
    let off = false
    fetch('/api/flexible-savings/terms', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: FlexibleTerms | null) => { if (!off && d) setTerms(d) })
      .catch(() => {})
    return () => { off = true }
  }, [])
  return terms
}
