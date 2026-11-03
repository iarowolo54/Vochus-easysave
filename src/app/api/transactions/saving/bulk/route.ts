import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { insufficientResponse, InsufficientFundsError, money } from '@/lib/wallet-guard'
import { debitAgentBalance } from '@/lib/wallet-debit'
import { creditRegistrationReward } from '@/lib/reward'
import { selectActivePlan } from '@/lib/saving-plan'
import { creditOpenPlan, hasOpenRedemption, PLAN_CLOSED, PlanClosedError, SAVING_BLOCKED } from '@/lib/redemption-balance'
import { chargingKeys, checkBulkSelection, liveSlots } from '@/lib/bulk-savings'
import { isEligiblePlan, perSlotAmount } from '@/lib/catchup'

class DaysTakenError extends Error {}

/** The calendar an agent picks from on an online plan. Offline plans use paid-dates, as they always have. */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: (session.user as { agentId?: string }).agentId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const planId = req.nextUrl.searchParams.get('planId')
  if (!planId) return NextResponse.json({ error: 'planId required' }, { status: 400 })

  // Own-the-data: only a plan belonging to one of this agent's customers.
  const plan = await prisma.savingsPlan.findFirst({ where: { id: planId, customer: { agentId: agent.id } } })
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  if (plan.source !== 'self') return NextResponse.json({ online: false })

  const now = new Date()
  const slots = await liveSlots(prisma, plan, now)
  return NextResponse.json({
    online: true,
    eligible: isEligiblePlan(plan) && plan.maturityDate.getTime() > now.getTime(),
    weekly: plan.cadence === 'weekly',
    perSlot: money(perSlotAmount(plan)),
    slots: slots.map(s => ({ key: s.key, state: s.state })),
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()
  const { customerId, dates: rawDates, method, planId } = body

  if (!customerId || !Array.isArray(rawDates) || rawDates.length < 1 || rawDates.length > 90) {
    return NextResponse.json({ error: 'Invalid input: provide 1–90 dates' }, { status: 400 })
  }

  const customer = await prisma.customer.findFirst({ where: { id: customerId, agentId: agent.id } })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  // Explicit plan selection — see transactions/saving for the rationale.
  const selected = await selectActivePlan(prisma, customer.id, planId)
  if ('error' in selected) {
    if (selected.error === 'none') return NextResponse.json({ error: 'No active savings plan' }, { status: 400 })
    if (selected.error === 'not_found') return NextResponse.json({ error: 'Plan not found for this customer' }, { status: 404 })
    return NextResponse.json({ error: 'This customer has more than one active plan — choose which plan to save into' }, { status: 400 })
  }
  const plan = await prisma.savingsPlan.findUnique({ where: { id: selected.plan.id } })
  if (!plan) return NextResponse.json({ error: 'No active savings plan' }, { status: 400 })
  if (await hasOpenRedemption(prisma, plan.id)) return NextResponse.json({ error: SAVING_BLOCKED }, { status: 409 })

  // Online plans follow the same rules as the customer's own Bulk Savings: WAT slot keys, a week costs 7 days,
  // and the days bought are recorded so auto-debit skips them. Offline plans stay per date, stamped with that date.
  const online = plan.source === 'self'
  if (online) {
    const keys = rawDates.filter((k: unknown): k is string => typeof k === 'string')
    const check = await checkBulkSelection(prisma, plan, keys.length === rawDates.length ? keys : [], new Date(), { kind: 'agent' })
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status })
  }

  const numDays = rawDates.length
  const dailyAmt = online ? money(perSlotAmount(plan)) : money(plan.dailyAmount)
  const totalAmt = money(dailyAmt * numDays)

  const priorSavings = await prisma.transaction.count({ where: { customerId: customer.id, type: 'saving' } })
  const txnCount = await prisma.transaction.count()

  const dates = (rawDates as string[]).map(s => new Date(s + 'T12:00:00'))

  let results: Awaited<ReturnType<typeof prisma.transaction.create>>[]
  try {
    results = await prisma.$transaction(async (tx) => {
      // Inside the write, so a charge that started since the check above is seen before any money moves.
      if (online) {
        const charging = await chargingKeys(tx, plan)
        if (rawDates.some((k: string) => charging.has(k))) throw new DaysTakenError()
      }
      // Atomically debit the agent's wallet (conditional decrement) so two
      // concurrent bulk saves can't overdraw it below zero.
      const debited = await debitAgentBalance(tx, agent.id, 'walletBalance', totalAmt)
      if (!debited) throw new InsufficientFundsError('Agent wallet', agent.walletBalance, totalAmt)

      const txns: Awaited<ReturnType<typeof prisma.transaction.create>>[] = []
      for (let i = 0; i < dates.length; i++) {
        const walletAfter = money(agent.walletBalance - dailyAmt * (i + 1))
        const created = await tx.transaction.create({
          data: {
            ref: `TXN-${String(9000 + txnCount + i + 1)}`,
            agentId: agent.id,
            customerId: customer.id,
            planId: plan.id,
            type: 'saving',
            amount: dailyAmt,
            method: method ?? 'Cash',
            status: 'Done',
            walletAfter,
            // SR-3: online (self) plans ignore client dates; createdAt defaults to now.
            ...(online ? {} : { createdAt: dates[i] }),
          },
        })
        txns.push(created)
        if (online) {
          const coversKey = rawDates[i] as string
          const row = await tx.planDayCoverage.upsert({
            where: { savingsPlanId_coversKey: { savingsPlanId: plan.id, coversKey } },
            create: { savingsPlanId: plan.id, coversKey, ref: created.ref },
            update: {},
          })
          // Paid for since the check above. Nothing has left the wallet yet, so refuse rather than overlap.
          if (row.ref !== created.ref) throw new DaysTakenError()
        }
      }
      await creditOpenPlan(tx, plan.id, totalAmt)
      return txns
    })
  } catch (e) {
    if (e instanceof InsufficientFundsError) return insufficientResponse(e)
    if (e instanceof PlanClosedError) return NextResponse.json({ error: PLAN_CLOSED }, { status: 409 })
    if (e instanceof DaysTakenError) return NextResponse.json({ error: 'One of these days has just been paid for or is being charged. Check the calendar and try again' }, { status: 409 })
    throw e
  }

  const firstTxn = results[0] as Awaited<ReturnType<typeof prisma.transaction.create>>

  logAudit({
    action: 'bulk_saving',
    entity: 'Transaction',
    entityId: firstTxn.id,
    details: `Bulk ₦${dailyAmt} × ${numDays} days = ₦${totalAmt} for ${customer.firstName} ${customer.lastName} via ${method ?? 'Cash'}`,
    actorId: agent.id,
    actorName: agent.name,
  })

  if (priorSavings === 0) {
    creditRegistrationReward(customer).catch(() => {})
  }

  return NextResponse.json({ transactions: results.slice(0, numDays), total: totalAmt, days: numDays, count: numDays })
}
