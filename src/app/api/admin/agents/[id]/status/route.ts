import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, adminActor } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const body = await req.json()
  const { status } = body

  if (!['Active', 'Suspended'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const agent = await prisma.agent.update({
    where: { id },
    // Bumping on suspension means reinstating doesn't revive old sessions: the agent has to log in again.
    data: { status, ...(status === 'Suspended' ? { tokenVersion: { increment: 1 } } : {}) },
    select: { id: true, name: true, agentId: true, status: true },
  })

  logAudit({
    action: 'agent_status_change',
    entity: 'Agent',
    entityId: agent.id,
    details: `Agent ${agent.name} (${agent.agentId}) status set to ${status}`,
    actorType: 'admin',
    ...adminActor(session),
  })

  return NextResponse.json({ agent: { id: agent.id, status: agent.status } })
}
