import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const fundings = await prisma.transaction.findMany({
    where: { agentId: agent.id, type: 'wallet_funding' },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  return NextResponse.json({ balance: agent.walletBalance, fundings })
}
