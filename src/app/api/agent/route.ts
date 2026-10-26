import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({
    where: { agentId: session.user.agentId },
    select: { id: true, agentId: true, name: true, phone: true, location: true, walletBalance: true, commissionBalance: true, createdAt: true, profileUnlocked: true, transactionPin: true, photoUrl: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  return NextResponse.json({ agent: { ...agent, hasPin: !!agent.transactionPin, transactionPin: undefined } })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  if (!agent.profileUnlocked) {
    return NextResponse.json({ error: 'Profile editing is locked. Contact your administrator.' }, { status: 403 })
  }

  const body = await req.json()
  const { name, phone, location } = body

  const updated = await prisma.agent.update({
    where: { id: agent.id },
    data: {
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
      ...(location ? { location } : {}),
      profileUnlocked: false,
    },
    select: { id: true, agentId: true, name: true, phone: true, location: true, walletBalance: true, profileUnlocked: true },
  })

  return NextResponse.json({ agent: updated })
}
