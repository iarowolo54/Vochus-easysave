import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { parsePaging } from '@/lib/paging'

export async function GET(req: NextRequest) {
  const guard = await requirePermission('oversight')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const action = searchParams.get('action') ?? ''

  const { page, limit, skip } = parsePaging(searchParams)

  const where: Record<string, unknown> = {}
  if (action) where.action = { contains: action }
  if (search) {
    where.OR = [
      { action: { contains: search } },
      { entity: { contains: search } },
      { details: { contains: search } },
      { actorName: { contains: search } },
      { actorId: { contains: search } },
    ]
  }

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip }),
  ])

  return NextResponse.json({ logs, total, page, limit })
}
