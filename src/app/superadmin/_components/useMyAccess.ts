'use client'

import { useCallback, useEffect, useState } from 'react'
import { AREA_KEYS, MONEY_AREAS, type Area } from '@/lib/permissions'

export type MyAccess = { role: 'superadmin' | 'staff'; areas: Area[]; hasApprovalPin: boolean }
export type MyAccessState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; access: MyAccess }

function isAccess(d: unknown): d is MyAccess {
  if (typeof d !== 'object' || d === null) return false
  const o = d as Record<string, unknown>
  return (o.role === 'superadmin' || o.role === 'staff') && Array.isArray(o.areas)
}

/** The signed-in admin's role and areas from /api/admin/me. Cosmetic only: the server enforces access. */
export function useMyAccess(enabled: boolean) {
  const [state, setState] = useState<MyAccessState>({ status: 'loading' })

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/me')
      const d: unknown = r.ok ? await r.json() : null
      if (!isAccess(d)) throw new Error()
      const areas = d.areas.filter((a): a is Area => (AREA_KEYS as readonly string[]).includes(a))
      setState({ status: 'ready', access: { role: d.role, areas, hasApprovalPin: !!d.hasApprovalPin } })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => { if (enabled) load() }, [enabled, load])

  return { state, reload: load }
}

export const hasMoneyArea = (areas: Area[]) => areas.some(a => MONEY_AREAS.includes(a))
