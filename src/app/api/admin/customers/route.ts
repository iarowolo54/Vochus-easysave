import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { customerType } from '@/lib/customer-type'

export async function GET(req: NextRequest) {
  const guard = await requirePermission('customers', 'view')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''

  const customers = await prisma.customer.findMany({
    where: search
      ? {
          OR: [
            { firstName: { contains: search } },
            { lastName: { contains: search } },
            { customerId: { contains: search } },
            { phone: { contains: search } },
          ],
        }
      : undefined,
    include: {
      agent: { select: { name: true, agentId: true } },
      savingsPlans: { select: { balance: true, status: true, source: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

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
      deviceBound: c.boundDeviceId != null,
      createdAt: c.createdAt,
      agentName: c.agent.name,
      agentId: c.agent.agentId,
      totalBalance: c.savingsPlans.reduce((s, p) => s + p.balance, 0),
      activePlans: c.savingsPlans.filter(p => p.status === 'Active').length,
      gender: c.gender,
      state: c.state,
      lga: c.lga,
      type: customerType(c.savingsPlans),
      lastPaidAt: lastPaid.get(c.id)?.toISOString() ?? null,
    })),
  })
}
