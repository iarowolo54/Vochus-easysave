'use client'
import { useEffect, useState } from 'react'

export interface PlanFees { live: boolean; periodicFeePct: number }

/** The fee settings the plan screens describe. Until loaded (or if it fails) the screens keep today's wording. */
export function usePlanFees(): PlanFees {
  const [fees, setFees] = useState<PlanFees>({ live: false, periodicFeePct: 0 })
  useEffect(() => {
    let off = false
    fetch('/api/plan-fees').then(r => (r.ok ? r.json() : null)).then((d: PlanFees | null) => { if (!off && d) setFees(d) }).catch(() => {})
    return () => { off = true }
  }, [])
  return fees
}
