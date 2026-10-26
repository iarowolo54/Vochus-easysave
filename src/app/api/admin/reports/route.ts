import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(adminAuthOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? ''

  const where: Record<string, unknown> = {}
  if (status) where.status = status

  const reports = await prisma.issueReport.findMany({
    where,
    include: { agent: { select: { name: true, agentId: true } } },
    orderBy: { createdAt: 'desc' },
  })

  const [openCount, inReviewCount, resolvedCount] = await Promise.all([
    prisma.issueReport.count({ where: { status: 'Open' } }),
    prisma.issueReport.count({ where: { status: 'In Review' } }),
    prisma.issueReport.count({ where: { status: 'Resolved' } }),
  ])

  return NextResponse.json({
    reports: reports.map(r => ({
      id: r.id,
      agentName: r.agent.name,
      agentId: r.agent.agentId,
      category: r.category,
      title: r.title,
      description: r.description,
      status: r.status,
      createdAt: r.createdAt,
    })),
    openCount,
    inReviewCount,
    resolvedCount,
  })
}
