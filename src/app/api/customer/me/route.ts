import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { accruedInterestForPlan, interestProjectionForPlan } from '@/lib/savings-interest-plan'
import { IN_FLIGHT_REDEMPTION_STATUSES } from '@/lib/redemption-statuses'

// A redemption is "pending" for the customer home until it is actually paid: everything in flight
// except Approved (handoff #30 — mid-payout AwaitingOTP/Finalizing must keep the tracker up and
// Save / New plan locked).
const PENDING_REDEMPTION_STATUSES = IN_FLIGHT_REDEMPTION_STATUSES.filter(s => s !== 'Approved')

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

  // Interest is computed fresh (not from the cron-refreshed column) so it is accurate immediately and
  // matches what the redemption request will pay. 0 for non-self plans.
  // `interest` is interest earned so far; `nextInterestAmount`/`daysToNextInterest` are the
  // forward-looking nudge for the next monthly credit (online plans only; null/0 for offline/matured).
  const now = new Date()
  const plans = await Promise.all(
    customer.savingsPlans.map(async p => {
      const [interest, projection] = await Promise.all([
        accruedInterestForPlan(prisma, p, now),
        interestProjectionForPlan(prisma, p, now),
      ])
      return {
        ...p,
        interest,
        nextInterestAmount: projection?.nextInterestAmount ?? 0,
        daysToNextInterest: projection?.daysToNextInterest ?? null,
      }
    }),
  )
  const plan = plans[0] ?? null
  const planIds = plans.map(p => p.id)

  // Every deposit on the customer's active plans, so the home screen can show per-plan history and
  // which days are paid (bulk deposits are stamped with the day they cover). Scoped to this customer.
  const [planTxs, pendingRedemptions] = await Promise.all([
    planIds.length
      ? prisma.transaction.findMany({
          where: { customerId: customer.id, type: 'saving', planId: { in: planIds } },
          orderBy: { createdAt: 'desc' },
          take: 2000,
          select: {
            id: true, amount: true, ref: true, createdAt: true, method: true, planId: true,
            agent: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    planIds.length
      ? prisma.earlyRedemption.findMany({
          where: { savingsPlanId: { in: planIds }, status: { in: PENDING_REDEMPTION_STATUSES } },
          select: { ref: true, status: true, savingsPlanId: true },
        })
      : Promise.resolve([]),
  ])

  const transactions = planTxs.map(({ agent, ...t }) => ({ ...t, recordedBy: agent.name }))
  // Kept for the save/redeem/settings pages, which read these older fields.
  const txs = transactions.slice(0, 30)
  const pendingRedemption = plan
    ? pendingRedemptions.find(r => r.savingsPlanId === plan.id) ?? null
    : null

  return NextResponse.json({
    id: customer.id,
    customerId: customer.customerId,
    name: `${customer.firstName} ${customer.lastName}`,
    phone: customer.phone,
    email: customer.email,
    gender: customer.gender,
    state: customer.state,
    lga: customer.lga,
    photoUrl: customer.photoUrl,
    agent: customer.agent,
    plan,
    plans,
    recentTransactions: txs,
    pendingRedemption: pendingRedemption && { ref: pendingRedemption.ref, status: pendingRedemption.status },
    transactions,
    pendingRedemptions,
  })
}
