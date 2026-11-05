import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Who a held payment can be credited to. Only what the picker shows: no photos, no phone numbers.
export async function GET(req: NextRequest) {
  const guard = await requirePermission('bank-transfers', 'manage')
  if (!guard.ok) return guard.response

  const kind = req.nextUrl.searchParams.get('kind')
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 60)
  if (q.length < 2) return NextResponse.json({ people: [] })

  if (kind === 'agent') {
    const agents = await prisma.agent.findMany({
      where: { OR: [{ name: { contains: q } }, { agentId: { contains: q } }] },
      select: { id: true, agentId: true, name: true },
      orderBy: { name: 'asc' },
      take: 8,
    })
    return NextResponse.json({ people: agents.map((a) => ({ id: a.id, code: a.agentId, name: a.name, plans: [] })) })
  }

  const customers = await prisma.customer.findMany({
    where: { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { customerId: { contains: q } }] },
    select: {
      id: true, customerId: true, firstName: true, lastName: true,
      savingsPlans: { where: { status: 'Active' }, select: { id: true, goal: true, balance: true }, orderBy: { startDate: 'desc' } },
    },
    orderBy: { firstName: 'asc' },
    take: 8,
  })
  return NextResponse.json({
    people: customers.map((c) => ({ id: c.id, code: c.customerId, name: `${c.firstName} ${c.lastName}`, plans: c.savingsPlans })),
  })
}
