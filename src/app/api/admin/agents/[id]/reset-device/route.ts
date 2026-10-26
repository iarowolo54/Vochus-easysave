import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const agent = await prisma.agent.update({ where: { id }, data: { boundDeviceId: null } })

  logAudit({
    action: 'agent_reset_device',
    entity: 'Agent',
    entityId: agent.id,
    details: `Reset bound device for ${agent.name} (${agent.agentId})`,
    actorType: 'admin',
    actorName: 'SuperAdmin',
  })

  return NextResponse.json({ ok: true })
}
