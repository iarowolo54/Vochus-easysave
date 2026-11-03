import { getServerSession, type Session } from 'next-auth'
import { NextResponse } from 'next/server'
import { adminAuthOptions } from './auth-admin'
import { prisma } from './prisma'
import { SCREENS, decideAdminAccess, parsePermissions, type Action, type Perm, type ScreenKey } from './permissions'

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
  departmentId: string | null
  roleRef: { status: string; permissions: string } | null
}

export type AdminGuardDeps = {
  getSession: () => Promise<Session | null>
  loadStaff: (id: string) => Promise<StaffRecord | null>
  loadDepartmentLead: (departmentId: string) => Promise<string | null>
}

const realDeps: AdminGuardDeps = {
  getSession: () => getServerSession(adminAuthOptions),
  // Always a fresh DB read: revoking a role/suspending staff takes effect immediately.
  loadStaff: (id) =>
    prisma.staffUser.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, departmentId: true, roleRef: { select: { status: true, permissions: true } } },
    }),
  loadDepartmentLead: async (departmentId) =>
    (await prisma.department.findUnique({ where: { id: departmentId }, select: { leadId: true } }))?.leadId ?? null,
}

const deny = (status: 401 | 403): { ok: false; response: NextResponse } => ({
  ok: false,
  response: NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status }),
})

/** Exported for tests (inject deps); routes use requirePermission / requireAdminArea. */
export async function resolveAdminAccess(
  screen: ScreenKey | null,
  action: Action,
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
      screen,
      action,
      staffStatus: staff?.status,
      roleStatus: staff?.roleRef?.status,
      rolePerms: staff?.roleRef ? parsePermissions(staff.roleRef.permissions) : null,
    })
    if (staff) {
      actorId = staff.id
      name = staff.name ?? name
    }
  } else {
    decision = decideAdminAccess({ role, screen, action })
  }

  if (decision === 'deny-401') return deny(401)
  if (decision === 'deny-403') return deny(403)
  return {
    ok: true,
    session: session as Session,
    actor: { id: actorId, name: name ?? 'Admin', type: role === 'staff' ? 'staff' : 'superadmin' },
  }
}

/** Superadmin, or active staff whose active role grants `screen:action` (manage implies view). */
export function requirePermission(screen: ScreenKey, action: Action): Promise<AdminGuard> {
  return resolveAdminAccess(screen, action)
}

/** Exported for tests. Allowed if ANY option is granted; otherwise the first option's denial. */
export async function resolveAnyPermission(
  options: readonly (readonly [ScreenKey, Action])[],
  deps: AdminGuardDeps = realDeps,
): Promise<AdminGuard> {
  let first: AdminGuard | null = null
  for (const [screen, action] of options) {
    const g = await resolveAdminAccess(screen, action, deps)
    if (g.ok) return g
    first ??= g
  }
  return first ?? deny(403)
}

/** For a handler that two screens may legitimately own (e.g. reset-device: agents or devices). */
export function requireAnyPermission(options: readonly (readonly [ScreenKey, Action])[]): Promise<AdminGuard> {
  return resolveAnyPermission(options)
}

/** Superadmin or any active staff (baseline admin-area access, no specific screen). */
export function requireAdminArea(): Promise<AdminGuard> {
  return resolveAdminAccess(null, 'view')
}

/**
 * Exported for tests. Superadmin, or the Active lead of exactly this department.
 * `leadId` alone is never trusted: the lead's status and membership are re-read, so a
 * suspended or moved lead loses lead powers immediately.
 */
export async function resolveDeptManage(departmentId: string, deps: AdminGuardDeps = realDeps): Promise<AdminGuard> {
  const session = await deps.getSession()
  const role = (session?.user as any)?.role
  const id = (session?.user as any)?.id as string | undefined
  if (!role) return deny(401)
  if (role === 'superadmin') {
    return { ok: true, session: session as Session, actor: { id, name: session?.user?.name ?? 'Super Admin', type: 'superadmin' } }
  }
  if (role !== 'staff' || !id) return deny(403)

  const staff = await deps.loadStaff(id)
  if (!staff || staff.status !== 'Active' || staff.departmentId !== departmentId) return deny(403)
  if ((await deps.loadDepartmentLead(departmentId)) !== staff.id) return deny(403)
  return { ok: true, session: session as Session, actor: { id: staff.id, name: staff.name ?? session?.user?.name ?? 'Admin', type: 'staff' } }
}

/** Owner, or the Active lead of `departmentId` (see resolveDeptManage). */
export function requireDeptManage(departmentId: string): Promise<AdminGuard> {
  return resolveDeptManage(departmentId)
}

/**
 * The department this staffer currently leads, or null. Fresh read: the staffer must be Active,
 * be the department's lead, and still belong to it (same rule as requireDeptManage).
 */
export async function findLeadDepartmentId(staffId: string): Promise<string | null> {
  const dept = await prisma.department.findFirst({
    where: { leadId: staffId, members: { some: { id: staffId, status: 'Active' } } },
    select: { id: true },
  })
  return dept?.id ?? null
}

/** The actor's current permission ceiling (fresh). The owner holds every permission. */
export async function actorPermissions(actor: { id?: string; type: 'superadmin' | 'staff' }): Promise<Perm[]> {
  if (actor.type === 'superadmin') {
    return SCREENS.flatMap((s) => s.actions.map((a) => `${s.key}:${a}` as Perm))
  }
  if (!actor.id) return []
  const staff = await prisma.staffUser.findUnique({
    where: { id: actor.id },
    select: { status: true, roleRef: { select: { status: true, permissions: true } } },
  })
  if (!staff || staff.status !== 'Active' || staff.roleRef?.status !== 'Active') return []
  return parsePermissions(staff.roleRef.permissions)
}
