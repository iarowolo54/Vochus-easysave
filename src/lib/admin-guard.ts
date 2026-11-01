import { getServerSession, type Session } from 'next-auth'
import { NextResponse } from 'next/server'
import { adminAuthOptions } from './auth-admin'
import { prisma } from './prisma'
import { decideAdminAccess, parsePermissions, type Area } from './permissions'

type Guard = { ok: true; session: Session } | { ok: false; response: NextResponse }

export async function requireSuperAdmin(): Promise<Guard> {
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if ((session.user as any).role !== 'superadmin') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, session }
}

/** Audit actor for the signed-in admin (real id + name, never a hardcoded label). */
export function adminActor(session: Session): { actorId?: string; actorName: string } {
  const u = session.user as { id?: string; name?: string | null } | undefined
  return { actorId: u?.id, actorName: u?.name || 'Super Admin' }
}

/** True for Prisma "record not found" (P2025) so routes can answer 404 instead of 500. */
export function isNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2025'
}

export type AdminGuard =
  | { ok: true; session: Session; actor: { id?: string; name: string; type: 'superadmin' | 'staff' } }
  | { ok: false; response: NextResponse }

type StaffRecord = {
  id: string
  name: string | null
  status: string
  roleRef: { status: string; permissions: string } | null
}

export type AdminGuardDeps = {
  getSession: () => Promise<Session | null>
  loadStaff: (id: string) => Promise<StaffRecord | null>
}

const realDeps: AdminGuardDeps = {
  getSession: () => getServerSession(adminAuthOptions),
  // Always a fresh DB read: revoking a role/suspending staff takes effect immediately.
  loadStaff: (id) =>
    prisma.staffUser.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, roleRef: { select: { status: true, permissions: true } } },
    }),
}

/** Exported for tests (inject deps); routes use requirePermission / requireAdminArea. */
export async function resolveAdminAccess(
  area: Area | null,
  deps: AdminGuardDeps = realDeps,
): Promise<AdminGuard> {
  const session = await deps.getSession()
  const role = (session?.user as any)?.role
  const id = (session?.user as any)?.id as string | undefined
  let name = session?.user?.name ?? null
  let actorId = id

  let decision
  if (role === 'staff') {
    const staff = id ? await deps.loadStaff(id) : null
    decision = decideAdminAccess({
      role,
      area,
      staffStatus: staff?.status,
      roleStatus: staff?.roleRef?.status,
      rolePerms: staff?.roleRef ? parsePermissions(staff.roleRef.permissions) : null,
    })
    if (staff) {
      actorId = staff.id
      name = staff.name ?? name
    }
  } else {
    decision = decideAdminAccess({ role, area })
  }

  if (decision === 'deny-401') {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (decision === 'deny-403') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return {
    ok: true,
    session: session as Session,
    actor: { id: actorId, name: name ?? 'Admin', type: role === 'staff' ? 'staff' : 'superadmin' },
  }
}

/** Superadmin, or active staff whose active role grants `area`. */
export function requirePermission(area: Area): Promise<AdminGuard> {
  return resolveAdminAccess(area)
}

/** Superadmin or any active staff (baseline admin-area access, no specific area). */
export function requireAdminArea(): Promise<AdminGuard> {
  return resolveAdminAccess(null)
}
