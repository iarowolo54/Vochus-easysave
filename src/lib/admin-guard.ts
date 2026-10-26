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
