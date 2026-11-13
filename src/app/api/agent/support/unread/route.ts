import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { partyUnreadResponse } from '@/lib/support-party'

export const dynamic = 'force-dynamic'

/** Unread Vochus Support messages for the signed-in agent. Read-only, for the badge. */
export async function GET() {
  const session = await getServerSession(authOptions)
  const code = (session?.user as { agentId?: unknown } | undefined)?.agentId
  if (typeof code !== 'string' || !code) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const agent = await prisma.agent.findUnique({ where: { agentId: code }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return partyUnreadResponse({ type: 'agent', id: agent.id })
}
