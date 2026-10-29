import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import bcrypt from 'bcryptjs'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

// Mirrors the agent login lockout in auth.ts so this endpoint can't be used to
// brute-force the current password from a hijacked session.
const LOCKOUT_MS = 30 * 60 * 1000
const FAIL_LIMIT = 3

// Change the signed-in agent's password with their current one (#11). The only
// other path was the forgot-password reset flow.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { currentPassword, newPassword } = await req.json()
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'Current and new password are required' }, { status: 400 })
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 })
  }

  if (agent.status !== 'Active') {
    return NextResponse.json({ error: 'This account is not active' }, { status: 403 })
  }

  // Clear an expired lockout first (same as login), so the agent isn't stuck.
  if (agent.lockedAt && Date.now() - new Date(agent.lockedAt).getTime() >= LOCKOUT_MS) {
    await prisma.agent.update({ where: { id: agent.id }, data: { loginAttempts: 0, lockedAt: null } })
  }

  // Reserve an attempt ATOMICALLY before running bcrypt: only when not locked and
  // under the limit. 0 rows updated => locked / over limit => reject. This closes
  // the TOCTOU where concurrent wrong guesses all read the same loginAttempts.
  const reserved = await prisma.agent.updateMany({
    where: { id: agent.id, lockedAt: null, loginAttempts: { lt: FAIL_LIMIT } },
    data: { loginAttempts: { increment: 1 } },
  })
  if (reserved.count === 0) {
    return NextResponse.json({ error: 'Account temporarily locked after too many attempts. Try again later.' }, { status: 423 })
  }

  const ok = await bcrypt.compare(String(currentPassword), agent.password)
  if (!ok) {
    // The attempt was already counted; lock if this reached the limit.
    const fresh = await prisma.agent.findUnique({ where: { id: agent.id }, select: { loginAttempts: true } })
    if ((fresh?.loginAttempts ?? 0) >= FAIL_LIMIT) {
      await prisma.agent.update({ where: { id: agent.id }, data: { lockedAt: new Date() } })
    }
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
  }

  // On success: set the password, clear the lockout, revoke biometric tokens,
  // and bump tokenVersion so existing NextAuth JWT sessions are rejected on their
  // next request — no stale credential survives a password change.
  const hashed = await bcrypt.hash(newPassword, 10)
  await prisma.$transaction([
    // Bump tokenVersion so existing NextAuth JWTs are rejected on their next
    // request (see the session callback in auth.ts).
    prisma.agent.update({ where: { id: agent.id }, data: { password: hashed, loginAttempts: 0, lockedAt: null, tokenVersion: { increment: 1 } } }),
    prisma.biometricToken.updateMany({ where: { agentId: agent.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ])

  logAudit({
    action: 'agent_password_change',
    entity: 'Agent',
    entityId: agent.id,
    details: `Agent ${agent.name} (${agent.agentId}) changed their password`,
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ ok: true })
}
