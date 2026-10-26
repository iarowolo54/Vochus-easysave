import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'

function unauthorized() {
  const res = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Nuke a stale cookie so the client stops trying with a dead session id.
  res.cookies.set({ name: 'customer_token', value: '', maxAge: 0, path: '/' })
  return res
}

export async function GET() {
  const session = await getCustomerSession()
  if (!session) return unauthorized()

  const customer = await prisma.customer.findUnique({
    where: { id: session.id },
    include: {
      agent: { select: { name: true, agentId: true, phone: true } },
      savingsPlans: {
        where: { status: 'Active' },
        orderBy: { startDate: 'desc' },
      },
    },
  })

  // Ensure cadence is included in response
  if (customer?.savingsPlans) {
    customer.savingsPlans = customer.savingsPlans.map(p => ({
      ...p,
      cadence: p.cadence ?? 'daily',
    }))
  }
  if (!customer) return unauthorized()

  const plans = customer.savingsPlans
  const plan = plans[0] ?? null

  const [txs, pendingRedemption] = await Promise.all([
    plan
      ? prisma.transaction.findMany({
          where: { customerId: customer.id, type: 'saving' },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: { id: true, amount: true, ref: true, createdAt: true, method: true },
        })
      : Promise.resolve([]),
    plan
      ? prisma.earlyRedemption.findFirst({
          where: { savingsPlanId: plan.id, status: { in: ['Pending', 'TokenValidated', 'AgentApproved'] } },
          select: { ref: true, status: true },
        })
      : Promise.resolve(null),
  ])

  return NextResponse.json({
    id: customer.id,
    customerId: customer.customerId,
    name: `${customer.firstName} ${customer.lastName}`,
    phone: customer.phone,
    email: customer.email,
    photoUrl: customer.photoUrl,
    agent: customer.agent,
    plan,
    plans,
    recentTransactions: txs,
    pendingRedemption,
  })
}
