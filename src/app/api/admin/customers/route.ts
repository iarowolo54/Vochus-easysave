import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      savingsPlans: { select: { balance: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({
    customers: customers.map(c => ({
      id: c.id,
      customerId: c.customerId,
      name: `${c.firstName} ${c.lastName}`,
      phone: c.phone,
      email: c.email,
      address: c.address,
      status: c.status,
      createdAt: c.createdAt,
      agentName: c.agent.name,
      agentId: c.agent.agentId,
      totalBalance: c.savingsPlans.reduce((s, p) => s + p.balance, 0),
      activePlans: c.savingsPlans.filter(p => p.status === 'Active').length,
      photoUrl: c.photoUrl,
    })),
  })
}
