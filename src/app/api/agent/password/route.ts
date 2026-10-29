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

  // Reject while the account is locked (same lockout as login) or inactive.
  if (agent.status !== 'Active') {
    return NextResponse.json({ error: 'This account is not active' }, { status: 403 })
  }
  if (agent.lockedAt && Date.now() - new Date(agent.lockedAt).getTime() < LOCKOUT_MS) {
    return NextResponse.json({ error: 'Account temporarily locked after too many attempts. Try again later.' }, { status: 423 })
  }

  const ok = await bcrypt.compare(String(currentPassword), agent.password)
  if (!ok) {
    // Count the wrong attempt and lock at the threshold, like login.
    const attempts = agent.loginAttempts + 1
    await prisma.agent.update({
      where: { id: agent.id },
      data: attempts >= FAIL_LIMIT ? { loginAttempts: attempts, lockedAt: new Date() } : { loginAttempts: attempts },
    })
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
  }

  // On success: set the password, clear the lockout, and revoke biometric tokens
  // — a persistent credential that would otherwise keep logging in with the old
  // password. (NextAuth JWTs are stateless, so existing web sessions are not
  // force-expired; documented as a follow-up.)
  const hashed = await bcrypt.hash(newPassword, 10)
  await prisma.$transaction([
    prisma.agent.update({ where: { id: agent.id }, data: { password: hashed, loginAttempts: 0, lockedAt: null } }),
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
