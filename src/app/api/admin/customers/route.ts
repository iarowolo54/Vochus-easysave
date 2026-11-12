import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { asCustomerType } from '@/lib/customer-type'
import { rankMatches } from '@/lib/fuzzy'

export async function GET(req: NextRequest) {
  const guard = await requirePermission('customers', 'view')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''

  // Search tolerates typos, so rank a few short columns in memory and fetch only the winners.
  let ranked: string[] | null = null
  if (search.trim()) {
    const pool = await prisma.customer.findMany({ select: { id: true, firstName: true, lastName: true, customerId: true, phone: true } })
    ranked = rankMatches(search, pool, c => [c.firstName, c.lastName, c.customerId, c.phone], 500).map(c => c.id)
  }

  const found = await prisma.customer.findMany({
    where: ranked ? { id: { in: ranked } } : undefined,
    include: {
      agent: { select: { name: true, agentId: true } },
      savingsPlans: { select: { balance: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  const customers = ranked ? ranked.flatMap(id => found.filter(c => c.id === id)) : found

  // One groupBy for the whole list (not a query per customer); same definition as /api/customers.
  const lastPaid = new Map<string, Date>()
  if (customers.length) {
    const rows = await prisma.transaction.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customers.map(c => c.id) }, type: 'saving', status: 'Done' },
      _max: { createdAt: true },
    })
    for (const r of rows) if (r.customerId && r._max.createdAt) lastPaid.set(r.customerId, r._max.createdAt)
  }

  // Which customers have a photo, without loading the photos themselves.
  const withPhoto = new Set(
    (await prisma.customer.findMany({ where: { photoUrl: { not: null } }, select: { id: true } })).map(r => r.id),
  )

  return NextResponse.json({
    customers: customers.map(c => ({
      id: c.id,
      customerId: c.customerId,
      name: `${c.firstName} ${c.lastName}`,
      phone: c.phone,
      email: c.email,
      address: c.address,
      status: c.status,
      // Whether the account is locked to a phone; the device id itself is never sent.
      photoUrl: withPhoto.has(c.id) ? `/api/admin/customers/${c.id}/photo` : null,
      deviceBound: c.boundDeviceId != null,
      createdAt: c.createdAt,
      agentName: c.agent.name,
      agentId: c.agent.agentId,
      totalBalance: c.savingsPlans.reduce((s, p) => s + p.balance, 0),
      activePlans: c.savingsPlans.filter(p => p.status === 'Active').length,
      gender: c.gender,
      state: c.state,
      lga: c.lga,
      type: asCustomerType(c.type),
      lastPaidAt: lastPaid.get(c.id)?.toISOString() ?? null,
    })),
  })
}
