import { NextRequest, NextResponse } from 'next/server'
import { requirePermission, adminActor } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('agents')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await params
  const { unlock } = await req.json()

  const agent = await prisma.agent.update({
    where: { id },
    data: { profileUnlocked: !!unlock },
    select: { id: true, profileUnlocked: true, name: true, agentId: true },
  })

  logAudit({
    action: unlock ? 'agent_profile_unlock' : 'agent_profile_lock',
    entity: 'Agent',
    entityId: agent.id,
    details: `Agent ${agent.name} (${agent.agentId}) profile ${unlock ? 'unlocked for editing' : 'locked'}`,
    actorType: 'admin',
    ...adminActor(session),
  })

  return NextResponse.json({ agent: { id: agent.id, profileUnlocked: agent.profileUnlocked } })
}
