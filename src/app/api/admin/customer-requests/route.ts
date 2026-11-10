import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { parseStoredPlans } from '@/lib/customer-request'

const PAGE_SIZE = 25
const STATUSES = ['Pending', 'Approved', 'Denied'] as const

export async function GET(req: NextRequest) {
  const guard = await requirePermission('customer-requests', 'view')
  if (!guard.ok) return guard.response

  const sp = req.nextUrl.searchParams
  const status = STATUSES.find(s => s === sp.get('status'))
  const q = (sp.get('q') ?? '').trim().slice(0, 60)
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const where: Prisma.CustomerRequestWhereInput = {
    ...(status && { status }),
    ...(q && { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { phone: { contains: q } }, { agent: { name: { contains: q } } }] }),
  }

  // No photo here: each one is a large base64 image. The detail route carries it.
  const [rows, total, grouped] = await Promise.all([
    prisma.customerRequest.findMany({
      where, orderBy: { submittedAt: 'desc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
      select: { id: true, status: true, firstName: true, lastName: true, phone: true, lga: true, state: true, plans: true, submittedAt: true, decidedAt: true, decidedBy: true, customerCode: true, agent: { select: { name: true, agentId: true } } },
    }),
    prisma.customerRequest.count({ where }),
    prisma.customerRequest.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  return NextResponse.json({
    rows: rows.map(({ plans, ...r }) => ({ ...r, planCount: parseStoredPlans(plans).length })),
    total, page, pageSize: PAGE_SIZE,
    counts: Object.fromEntries(grouped.map(g => [g.status, g._count._all])),
    canManage: (await requirePermission('customer-requests', 'manage')).ok,
  })
}
