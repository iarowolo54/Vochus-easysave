import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { partySendResponse, partyThreadResponse } from '@/lib/support-party'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

/** The signed-in agent's own chat with Vochus Support. The agent comes from the session, never the request. */
async function currentAgent() {
  const session = await getServerSession(authOptions)
  const code = (session?.user as { agentId?: unknown } | undefined)?.agentId
  if (typeof code !== 'string' || !code) return null
  return prisma.agent.findUnique({ where: { agentId: code }, select: { id: true, name: true } })
}

export async function GET() {
  const agent = await currentAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return partyThreadResponse({ type: 'agent', id: agent.id }, agent.name)
}

export async function POST(req: NextRequest) {
  const agent = await currentAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return partySendResponse({ type: 'agent', id: agent.id }, agent.name, await req.json().catch(() => null))
}
