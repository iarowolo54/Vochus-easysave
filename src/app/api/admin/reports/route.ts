import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const guard = await requirePermission('oversight')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? ''

  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(searchParams.get('pageSize'))) || 25))
  const page = Math.max(1, Math.floor(Number(searchParams.get('page'))) || 1)

  const where: Record<string, unknown> = {}
  if (status) where.status = status

  const [reports, total] = await Promise.all([
    prisma.issueReport.findMany({
      where,
      include: { agent: { select: { name: true, agentId: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.issueReport.count({ where }),
  ])

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
    total,
    openCount,
    inReviewCount,
    resolvedCount,
  })
}
