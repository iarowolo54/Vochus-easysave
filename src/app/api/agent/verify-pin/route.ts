import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({
    where: { agentId: session.user.agentId },
    select: { transactionPin: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  if (!agent.transactionPin) {
    return NextResponse.json({ error: 'No transaction PIN set. Please set up your PIN in Settings.' }, { status: 403 })
  }

  const { pin } = await req.json()
  const valid = await bcrypt.compare(pin, agent.transactionPin)
  if (!valid) return NextResponse.json({ error: 'Incorrect PIN' }, { status: 400 })

  return NextResponse.json({ ok: true })
}
