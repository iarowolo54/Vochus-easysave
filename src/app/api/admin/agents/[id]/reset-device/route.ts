import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPermission, isNotFound } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAnyPermission([['agents', 'manage'], ['devices', 'manage']])
  if (!guard.ok) return guard.response
  const session = guard.session

  // The old phone is signed out and its fingerprint sign-in revoked in the same step: a reset usually means the phone was lost
  // or replaced. The agent signs in again with their password on the new phone.
  const agent = await prisma.$transaction(async (tx) => {
    const updated = await tx.agent.update({ where: { id }, data: { boundDeviceId: null, tokenVersion: { increment: 1 } } })
    await tx.biometricToken.updateMany({ where: { agentId: id, revokedAt: null }, data: { revokedAt: new Date() } })
    return updated
  }).catch((e: unknown) => { if (isNotFound(e)) return null; throw e })
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
