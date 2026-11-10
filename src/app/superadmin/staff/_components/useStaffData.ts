'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Department, RoleRow, StaffData, StaffUser } from './shared'

const EMPTY: StaffData = { staff: [], roles: [], departments: [] }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(String(res.status))
  return res.json() as Promise<T>
}

/** Pass `enabled` false for someone with no staff screens to manage: the API would refuse them. */
export function useStaffData(enabled: boolean) {
  const [data, setData] = useState<StaffData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const reload = useCallback(async () => {
    setFailed(false)
    try {
      const [s, r, d] = await Promise.all([
        getJson<{ staff?: StaffUser[] }>('/api/admin/staff'),
        getJson<{ roles?: RoleRow[] }>('/api/admin/roles'),
        getJson<{ departments?: Department[] }>('/api/admin/departments'),
      ])
      setData({ staff: s.staff ?? [], roles: r.roles ?? [], departments: d.departments ?? [] })
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (enabled) reload() }, [enabled, reload])

  return { data, loading, failed, reload }
}
