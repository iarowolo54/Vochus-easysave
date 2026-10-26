import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const cards = await prisma.memberCard.findMany({
    where: { agentId: agent.id },
    include: { customer: { select: { firstName: true, lastName: true, customerId: true } } },
    orderBy: { linkedAt: 'desc' },
  })

  return NextResponse.json({ cards })
}
