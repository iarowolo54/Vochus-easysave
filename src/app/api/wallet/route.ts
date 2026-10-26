import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()
  const { amount, source, reference } = body
  const amt = parseFloat(amount)
  if (!amt || amt <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })

  const txnCount = await prisma.transaction.count()
  const ref = reference || `FND-${String(txnCount + 1).padStart(5, '0')}`

  const [txn, updatedAgent] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        ref,
        agentId: agent.id,
        type: 'wallet_funding',
        amount: amt,
        method: source ?? 'Bank Transfer',
        status: 'Done',
        note: `Wallet top-up via ${source ?? 'Bank Transfer'}`,
      },
    }),
    prisma.agent.update({
      where: { id: agent.id },
      data: { walletBalance: { increment: amt } },
    }),
  ])

  return NextResponse.json({ transaction: txn, newBalance: updatedAgent.walletBalance })
}

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
