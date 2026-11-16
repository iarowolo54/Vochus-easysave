import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

const STATUSES = ['Pending', 'Approved', 'Denied'] as const

/** Agent requests by status (waiting by default). Names only: no photos in a list. */
export async function GET(req: NextRequest) {
  const guard = await requirePermission('agent-requests', 'view')
  if (!guard.ok) return guard.response
  const raw = new URL(req.url).searchParams.get('status') ?? 'Pending'
  const status = (STATUSES as readonly string[]).includes(raw) ? raw : 'Pending'
  const [requests, counts] = await Promise.all([
    prisma.agentUpgradeRequest.findMany({
      where: { status },
      orderBy: { submittedAt: status === 'Pending' ? 'asc' : 'desc' },
      take: 200,
      select: {
        id: true, status: true, submittedAt: true, decidedAt: true, decidedBy: true, state: true, lga: true,
        customer: { select: { id: true, customerId: true, firstName: true, lastName: true, phone: true, createdAt: true } },
        agent: { select: { id: true, agentId: true, name: true } },
      },
    }),
    prisma.agentUpgradeRequest.groupBy({ by: ['status'], _count: { _all: true } }),
  ])
  return NextResponse.json({ requests, counts: Object.fromEntries(counts.map(c => [c.status, c._count._all])) })
}
