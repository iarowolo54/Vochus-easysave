import { getServerSession, type Session } from 'next-auth'
import { NextResponse } from 'next/server'
import { adminAuthOptions } from './auth-admin'

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
