import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const action = searchParams.get('action') ?? ''

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

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return NextResponse.json({ logs })
}
