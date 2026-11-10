import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type AgentGuard = { ok: true; agent: { id: string; agentId: string; name: string } } | { ok: false; response: NextResponse }

/** The signed-in agent, from the session only. */
export async function requireAgent(): Promise<AgentGuard> {
  const session = await getServerSession(authOptions)
  const agentId = (session?.user as { agentId?: string } | undefined)?.agentId
  if (!agentId) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const agent = await prisma.agent.findFirst({ where: { agentId }, select: { id: true, agentId: true, name: true } })
  if (!agent) return { ok: false, response: NextResponse.json({ error: 'Agent not found' }, { status: 404 }) }
  return { ok: true, agent }
}
