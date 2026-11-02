import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { INVALID_CODE_MESSAGE, limitByIp, readBody, text, verifyResetCode } from '@/lib/password-reset'

export async function POST(req: NextRequest) {
  const limited = limitByIp(req, 'guess')
  if (limited) return limited

  const body = await readBody(req)
  const id = text(body.identifier)
  const code = text(body.code)
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
  if (!id || !code || !newPassword) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  const agent = await prisma.agent.findFirst({
    where: {
      OR: [
        { agentId: id.toUpperCase() },
        { agentId: id },
        { phone: id },
      ],
    },
  })
  if (!agent || !(await verifyResetCode('agent', agent.id, text(body.resetId), code))) {
    return NextResponse.json({ error: INVALID_CODE_MESSAGE }, { status: 400 })
  }

  const hashed = await bcrypt.hash(newPassword, 10)
  // A reset ends every existing session and fingerprint sign-in on the account.
  await prisma.$transaction([
    prisma.agent.update({
      where: { id: agent.id },
      data: { password: hashed, loginAttempts: 0, lockedAt: null, tokenVersion: { increment: 1 } },
    }),
    prisma.biometricToken.updateMany({ where: { agentId: agent.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ])

  await logAudit({
    action: 'agent_password_reset',
    entity: 'Agent',
    entityId: agent.id,
    details: `Agent ${agent.name} (${agent.agentId}) reset password via forgot-password flow`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ success: true })
}
