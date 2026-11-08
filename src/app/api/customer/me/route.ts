import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { isHandCredit } from '@/lib/hand-receipt'
import { accruedInterestForPlan, interestProjectionForPlan } from '@/lib/savings-interest-plan'
import { excludeExpiredPending, IN_FLIGHT_REDEMPTION_STATUSES } from '@/lib/redemption-statuses'
import { coveringRefsByPlan } from '@/lib/bulk-savings'

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
  const plansBase = await Promise.all(
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
  const planIds = plansBase.map(p => p.id)

  // Days covered by Bulk Savings payments and the deposits that paid for them, per plan (scoped to this customer's plan ids).
  const coverageRows = planIds.length
    ? await prisma.planDayCoverage.findMany({
        where: { savingsPlanId: { in: planIds } },
        select: { savingsPlanId: true, coversKey: true },
        orderBy: { coversKey: 'asc' },
      })
    : []
  const coveringRefs = await coveringRefsByPlan(prisma, planIds)
  const plans = plansBase.map(p => ({
    ...p,
    coveredKeys: coverageRows.filter(r => r.savingsPlanId === p.id).map(r => r.coversKey),
    coveredRefs: coveringRefs.get(p.id) ?? [],
  }))
  const plan = plans[0] ?? null

  // Collected plans, offered on the home screen so the customer can save into one again. Kept apart from
  // `plans` because the save, collect and settings screens expect `plans` to hold only open plans.
  const redeemedPlans = await prisma.savingsPlan.findMany({
    // A collected Ajo pot can't be saved into again, so it isn't offered here.
    where: { customerId: customer.id, status: 'Redeemed', cadence: { not: 'ajo' } },
    orderBy: { startDate: 'desc' },
    take: 5,
    select: { id: true, goal: true, dailyAmount: true, periodDays: true, cadence: true },
  })

  // Every deposit on the customer's active plans, so the home screen can show per-plan history and
  // which days are paid (bulk deposits are stamped with the day they cover). Scoped to this customer.
  const [planTxs, pendingRedemptions] = await Promise.all([
    planIds.length
      ? prisma.transaction.findMany({
          where: { customerId: customer.id, type: 'saving', planId: { in: planIds } },
          orderBy: { createdAt: 'desc' },
          take: 2000,
          select: {
            id: true, amount: true, ref: true, createdAt: true, method: true, planId: true, note: true,
            agent: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    planIds.length
      ? prisma.earlyRedemption.findMany({
          where: { savingsPlanId: { in: planIds }, status: { in: PENDING_REDEMPTION_STATUSES }, ...excludeExpiredPending() },
          select: { ref: true, status: true, savingsPlanId: true },
        })
      : Promise.resolve([]),
  ])

  const transactions = planTxs.map(({ agent, note, ...t }) => ({ ...t, recordedBy: agent.name, confirmedByStaff: isHandCredit(note) }))
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
    emailVerified: customer.emailVerifiedAt != null,
    emailAlertsOn: customer.emailAlertsOn,
    gender: customer.gender,
    state: customer.state,
    lga: customer.lga,
    photoUrl: customer.photoUrl,
    agent: customer.agent,
    plan,
    plans,
    redeemedPlans,
    recentTransactions: txs,
    pendingRedemption: pendingRedemption && { ref: pendingRedemption.ref, status: pendingRedemption.status },
    transactions,
    pendingRedemptions,
  })
}
