import { NextRequest, NextResponse } from 'next/server'
import { AGENT_CASH_BLOCK, asCustomerType } from '@/lib/customer-type'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { assertSufficient, insufficientResponse, InsufficientFundsError, money } from '@/lib/wallet-guard'
import { debitAgentBalance } from '@/lib/wallet-debit'
import { creditRegistrationReward } from '@/lib/reward'
import { maxSinglePayment, overCapMessage } from '@/lib/payment-cap'
import { selectActivePlan, depositCreatedAt, hasSavingOnDay, alreadySavedMessage } from '@/lib/saving-plan'
import { periodSavedOn } from '@/lib/bulk-savings'
import { depositDayInPlan, outsidePlanMessage, planHasEnded, PLAN_ENDED } from '@/lib/plan-credit'
import { creditOpenPlan, hasOpenRedemption, PLAN_CLOSED, PlanClosedError, SAVING_BLOCKED } from '@/lib/redemption-balance'
import { depositFeeOps } from '@/lib/commission-ledger'
import { notifications, notify } from '@/lib/notifications'
import { getFlexibleSettings, isFlexible } from '@/lib/flexible-savings'
import { photoBlockedResponse, photoSaveBlock } from '@/lib/photo-deadline'

class AlreadySavedError extends Error {}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()
  const { customerId, amount, method, date, planId } = body
  const amt = parseFloat(amount)

  if (!customerId || !amt || amt <= 0) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const customer = await prisma.customer.findFirst({ where: { id: customerId, agentId: agent.id } })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  // Online savers pay by bank transfer only: no cash through an agent.
  if (asCustomerType(customer.type) === 'online') return NextResponse.json({ error: AGENT_CASH_BLOCK }, { status: 400 })
  {
    const blocked = await photoSaveBlock(prisma, customer.id, 'agent')
    if (blocked) return photoBlockedResponse(blocked)
  }

  // Save into the explicitly chosen plan. With no planId it only works when the
  // customer has exactly one Active plan — otherwise the caller must say which,
  // instead of money silently landing on "the newest plan".
  const selected = await selectActivePlan(prisma, customer.id, planId)
  if ('error' in selected) {
    if (selected.error === 'none') return NextResponse.json({ error: 'This customer has no plan open for saving. If their plan has ended, use Save again or start a new plan.' }, { status: 400 })
    if (selected.error === 'not_found') return NextResponse.json({ error: 'Plan not found for this customer' }, { status: 404 })
    return NextResponse.json({ error: 'This customer has more than one active plan — choose which plan to save into' }, { status: 400 })
  }
  const plan = selected.plan
  if (plan.source === 'self') return NextResponse.json({ error: AGENT_CASH_BLOCK }, { status: 400 })

  const dates = await prisma.savingsPlan.findUnique({ where: { id: plan.id }, select: { startDate: true, maturityDate: true, cadence: true, goal: true, dailyAmount: true, periodDays: true } })
  if (!dates || planHasEnded(dates)) return NextResponse.json({ error: PLAN_ENDED }, { status: 409 })

  if (await hasOpenRedemption(prisma, plan.id)) return NextResponse.json({ error: SAVING_BLOCKED }, { status: 409 })

  const rounded = money(amt)
  // Flexible plans: any amount from the smallest deposit up, as often as the customer likes (no one-a-day rule).
  const flexible = isFlexible(dates.cadence)
  if (flexible) {
    const { minDeposit } = await getFlexibleSettings(prisma)
    if (rounded < minDeposit) return NextResponse.json({ error: `The smallest deposit is ₦${minDeposit.toLocaleString('en-NG')}.` }, { status: 400 })
  }
  // One payment can't be more than the plan's amount for the days it has left (owner's rule).
  const max = flexible ? null : maxSinglePayment(dates)
  if (max !== null && rounded > max) return NextResponse.json({ error: overCapMessage(max) }, { status: 400 })
  // SR-3: ignore a client backdate on online (self) plans.
  const createdAt = depositCreatedAt(plan.source, date)
  // A cash saving recorded for a chosen day must be for a day the plan runs (not past its end, not before its start).
  if (createdAt && !depositDayInPlan(dates, createdAt)) return NextResponse.json({ error: outsidePlanMessage(dates) }, { status: 400 })

  const priorSavings = await prisma.transaction.count({
    where: { customerId: customer.id, type: 'saving' },
  })

  const walletAfter = agent.walletBalance - rounded

  try {
    assertSufficient('Agent wallet', agent.walletBalance, rounded)
  } catch (e) {
    if (e instanceof InsufficientFundsError) return insufficientResponse(e)
    throw e
  }

  const txnCount = await prisma.transaction.count()
  const ref = `TXN-${String(9000 + txnCount + 1)}`

  // Weekly and monthly cash plans keep the one-saving-a-day rule until whole-period Bulk Savings goes live.
  const cashPeriod = plan.source !== 'self' && (dates.cadence === 'weekly' || dates.cadence === 'monthly')

  let txn
  try {
    txn = await prisma.$transaction(async (tx) => {
      // One saving per plan per day. Checked inside the write so two quick taps can't both pass.
      if (!flexible && await hasSavingOnDay(tx, plan.id, createdAt ?? new Date())) throw new AlreadySavedError()
      // An online week or month holds one saving too, and a day bought through Bulk Savings is already paid.
      if (!cashPeriod && await periodSavedOn(tx, { ...dates, id: plan.id }, createdAt ?? new Date())) throw new AlreadySavedError()
      // Atomically debit the agent's wallet; concurrent savings can't overdraw.
      const debited = await debitAgentBalance(tx, agent.id, 'walletBalance', rounded)
      if (!debited) throw new InsufficientFundsError('Agent wallet', agent.walletBalance, rounded)
      const fee = await depositFeeOps(tx, { planId: plan.id, agentId: agent.id, customerId: customer.id, amount: rounded, ref })
      const created = await tx.transaction.create({
        data: {
          ref,
          agentId: agent.id,
          customerId: customer.id,
          planId: plan.id,
          type: 'saving',
          amount: rounded,
          method: method ?? 'Cash',
          status: 'Done',
          walletAfter,
          feeTaken: fee,
          ...(createdAt ? { createdAt } : {}),
        },
      })
      // notify: savingsReceived
      await creditOpenPlan(tx, plan.id, money(rounded - fee))
      await notify(tx, notifications.savingsReceived({
        ref, customerId: customer.id, agentId: agent.id, customerName: `${customer.firstName} ${customer.lastName}`,
        planGoal: dates.goal, amount: rounded, fee, onlineTransfer: false,
      }))
      return created
    })
  } catch (e) {
    if (e instanceof InsufficientFundsError) return insufficientResponse(e)
    if (e instanceof AlreadySavedError) return NextResponse.json({ error: alreadySavedMessage(cashPeriod ? 'daily' : dates.cadence) }, { status: 409 })
    if (e instanceof PlanClosedError) return NextResponse.json({ error: PLAN_CLOSED }, { status: 409 })
    throw e
  }

  logAudit({ action: 'saving', entity: 'Transaction', entityId: txn.id, details: `₦${rounded} saving for ${customer.firstName} ${customer.lastName} (${ref}) via ${method ?? 'Cash'}`, actorId: agent.id, actorName: agent.name })

  if (priorSavings === 0) {
    creditRegistrationReward(customer).catch(() => {})
  }

  return NextResponse.json({ transaction: txn })
}
