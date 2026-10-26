import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(adminAuthOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
