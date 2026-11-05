import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { cancelTransferIntent } from '@/lib/transfer-intent'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId }, select: { id: true, name: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body: unknown = await req.json().catch(() => null)
  const ref = body && typeof body === 'object' ? (body as { ref?: unknown }).ref : null
  if (typeof ref !== 'string' || !ref) return NextResponse.json({ error: 'Missing reference' }, { status: 400 })

  const cancelled = await cancelTransferIntent(ref, { agentId: agent.id })
  if (cancelled) {
    logAudit({
      action: 'transfer_cancelled', entity: 'PaymentIntent', details: `Agent ${agent.name} cancelled wallet top-up request ${ref}`,
      actorType: 'agent', actorId: agent.id, actorName: agent.name,
    })
  }
  return NextResponse.json({ cancelled })
}
