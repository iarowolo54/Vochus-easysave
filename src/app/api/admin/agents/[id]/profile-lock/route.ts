import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    actorName: 'SuperAdmin',
  })

  return NextResponse.json({ agent: { id: agent.id, profileUnlocked: agent.profileUnlocked } })
}
