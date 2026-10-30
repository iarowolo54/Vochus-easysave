import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { findIdentityConflict } from '@/lib/identity'
import { identityConflictResponse } from '@/lib/identity-response'

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

  // Validate before touching the DB (#10).
  if (typeof name !== 'string' || !name.trim() || typeof location !== 'string' || !location.trim()) {
    return NextResponse.json({ error: 'Name and location are required' }, { status: 400 })
  }
  if (typeof phone !== 'string' || !/^0\d{10}$/.test(phone)) {
    return NextResponse.json({ error: 'Phone must be 11 digits starting with 0' }, { status: 400 })
  }

  const conflict = await findIdentityConflict(prisma, { phone })
  if (conflict) return identityConflictResponse(conflict)

  let subAgent
  try {
    subAgent = await prisma.subAgent.create({
      data: { parentAgentId: agent.id, name: name.trim(), phone, location: location.trim(), walletBalance: 0 },
    })
  } catch (e) {
    // SubAgent.phone is unique — surface a clean 409 instead of a 500 (#10).
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'This phone number is already registered as a sub-agent' }, { status: 409 })
    }
    throw e
  }

  logAudit({
    action: 'subagent_create',
    entity: 'SubAgent',
    entityId: subAgent.id,
    details: `Created sub-agent ${name} (${phone}) at ${location} under ${agent.name}`,
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ subAgent }, { status: 201 })
}
