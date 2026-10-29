import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import bcrypt from 'bcryptjs'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

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

  const ok = await bcrypt.compare(String(currentPassword), agent.password)
  if (!ok) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })

  await prisma.agent.update({ where: { id: agent.id }, data: { password: await bcrypt.hash(newPassword, 10) } })

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
