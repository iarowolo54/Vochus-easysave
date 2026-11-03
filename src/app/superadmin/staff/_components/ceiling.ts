import type { Perm } from '@/lib/permissions'
import type { MyAccess } from '../../_components/useMyAccess'

/** The owner is unbounded (null); a department lead is bounded by the permissions their own role holds. */
export function actorCeiling(access: MyAccess): Perm[] | null {
  return access.role === 'superadmin' ? null : access.perms
}
