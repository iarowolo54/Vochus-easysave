import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, adminActor } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const agent = await prisma.agent.update({
    where: { id },
    data: {
      lockedAt: null,
      loginAttempts: 0,
      unlockToken: null,
      unlockTokenExpiry: null,
    },
  })

  logAudit({
    action: 'agent_unblock',
    entity: 'Agent',
    entityId: agent.id,
    details: `Agent ${agent.name} (${agent.agentId}) unblocked`,
    actorType: 'admin',
    ...adminActor(session),
  })

  return NextResponse.json({ ok: true })
}
