import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission, isNotFound } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAnyPermission([['agents', 'manage'], ['devices', 'manage']])
  if (!guard.ok) return guard.response
  const session = guard.session

  const agent = await prisma.agent.update({ where: { id }, data: { boundDeviceId: null } })
    .catch((e: unknown) => { if (isNotFound(e)) return null; throw e })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  logAudit({
    action: 'agent_reset_device',
    entity: 'Agent',
    entityId: agent.id,
    details: `Reset bound device for ${agent.name} (${agent.agentId})`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true })
}
