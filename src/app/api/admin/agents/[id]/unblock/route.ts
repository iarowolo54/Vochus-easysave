import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    actorName: 'SuperAdmin',
  })

  return NextResponse.json({ ok: true })
}
