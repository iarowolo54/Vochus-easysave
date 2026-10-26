import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const { identifier, code, newPassword } = await req.json()
  if (!identifier || !code || !newPassword) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  const id = identifier.trim()
  const agent = await prisma.agent.findFirst({
    where: {
      OR: [
        { agentId: id.toUpperCase() },
        { agentId: id },
        { phone: id },
      ],
    },
  })

  if (!agent || !agent.email) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const otp = await prisma.emailOTP.findFirst({
    where: { email: agent.email, code, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: 'desc' },
  })

  if (!otp) {
    return NextResponse.json({ error: 'Invalid or expired code — request a new one' }, { status: 400 })
  }

  const hashed = await bcrypt.hash(newPassword, 10)
  await prisma.agent.update({
    where: { id: agent.id },
    data: { password: hashed, loginAttempts: 0, lockedAt: null },
  })
  await prisma.emailOTP.deleteMany({ where: { email: agent.email } })

  logAudit({
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
