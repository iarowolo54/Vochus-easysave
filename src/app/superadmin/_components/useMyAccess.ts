'use client'

import { useCallback, useEffect, useState } from 'react'
import { MONEY_SCREENS, hasPermission, parsePermissions, type Perm, type ScreenKey } from '@/lib/permissions'

export type MyAccess = {
  role: 'superadmin' | 'staff'
  perms: Perm[]
  isLead: boolean
  leadDepartmentId?: string
  hasApprovalPin: boolean
}
export type MyAccessState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; access: MyAccess }

function isAccess(d: unknown): d is { role: 'superadmin' | 'staff'; perms: unknown[]; isLead?: unknown; leadDepartmentId?: unknown; hasApprovalPin?: unknown } {
  if (typeof d !== 'object' || d === null) return false
  const o = d as Record<string, unknown>
  return (o.role === 'superadmin' || o.role === 'staff') && Array.isArray(o.perms)
}

/** The signed-in admin's role, per-screen permissions and lead status from /api/admin/me. Cosmetic only: the server enforces access. */
export function useMyAccess(enabled: boolean) {
  const [state, setState] = useState<MyAccessState>({ status: 'loading' })

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/me')
      const d: unknown = r.ok ? await r.json() : null
      if (!isAccess(d)) throw new Error()
      setState({
        status: 'ready',
        access: {
          role: d.role,
          perms: parsePermissions(JSON.stringify(d.perms)),
          isLead: d.isLead === true,
          leadDepartmentId: typeof d.leadDepartmentId === 'string' ? d.leadDepartmentId : undefined,
          hasApprovalPin: !!d.hasApprovalPin,
        },
      })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => { if (enabled) load() }, [enabled, load])

  return { state, reload: load }
}

/** The approval PIN matters to anyone who can manage a screen that moves money. */
export const hasMoneyManage = (perms: Perm[]) => MONEY_SCREENS.some(s => hasPermission(perms, s, 'manage'))
export const canViewScreen = (access: MyAccess, screen: ScreenKey) => access.role === 'superadmin' || hasPermission(access.perms, screen, 'view')
