import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const reports = await prisma.issueReport.findMany({
    where: { agentId: agent.id },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ reports })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()
  const { category, title, description } = body

  if (!category || !title || !description) {
    return NextResponse.json({ error: 'category, title, and description are required' }, { status: 400 })
  }

  const report = await prisma.issueReport.create({
    data: { agentId: agent.id, category, title, description, status: 'Open' },
  })

  return NextResponse.json({ report }, { status: 201 })
}
