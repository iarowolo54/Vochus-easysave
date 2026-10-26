import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const plan = body.plan ?? null

  const token = crypto.randomBytes(16).toString('hex')

  await prisma.customerInvite.create({
    data: { token, agentId: agent.id, plan },
  })

  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const link = `${base}/customer/enroll?ref=${token}&aid=${agent.agentId}${plan ? `&plan=${plan}` : ''}`

  return NextResponse.json({ token, link })
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const invites = await prisma.customerInvite.findMany({
    where: { agentId: agent.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  return NextResponse.json({ invites })
}
