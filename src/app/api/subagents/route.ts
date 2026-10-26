import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const subAgents = await prisma.subAgent.findMany({
    where: { parentAgentId: agent.id },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ subAgents })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()
  const { name, phone, location } = body

  const subAgent = await prisma.subAgent.create({
    data: { parentAgentId: agent.id, name, phone, location, walletBalance: 0 },
  })

  logAudit({
    action: 'subagent_create',
    entity: 'SubAgent',
    entityId: subAgent.id,
    details: `Created sub-agent ${name} (${phone}) at ${location ?? 'n/a'} under ${agent.name}`,
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ subAgent }, { status: 201 })
}
