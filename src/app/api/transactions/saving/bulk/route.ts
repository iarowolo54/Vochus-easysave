import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { insufficientResponse, InsufficientFundsError, money } from '@/lib/wallet-guard'
import { debitAgentBalance } from '@/lib/wallet-debit'
import { creditRegistrationReward } from '@/lib/reward'
import { selectActivePlan } from '@/lib/saving-plan'

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

  const numDays = rawDates.length
  const dailyAmt = money(plan.dailyAmount)
  const totalAmt = money(dailyAmt * numDays)

  const priorSavings = await prisma.transaction.count({ where: { customerId: customer.id, type: 'saving' } })
  const txnCount = await prisma.transaction.count()

  const dates = (rawDates as string[]).map(s => new Date(s + 'T12:00:00'))

  let results: Awaited<ReturnType<typeof prisma.transaction.create>>[]
  try {
    results = await prisma.$transaction(async (tx) => {
      // Atomically debit the agent's wallet (conditional decrement) so two
      // concurrent bulk saves can't overdraw it below zero.
      const debited = await debitAgentBalance(tx, agent.id, 'walletBalance', totalAmt)
      if (!debited) throw new InsufficientFundsError('Agent wallet', agent.walletBalance, totalAmt)

      const txns: Awaited<ReturnType<typeof prisma.transaction.create>>[] = []
      for (let i = 0; i < dates.length; i++) {
        const walletAfter = money(agent.walletBalance - dailyAmt * (i + 1))
        txns.push(await tx.transaction.create({
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
            ...(plan.source === 'self' ? {} : { createdAt: dates[i] }),
          },
        }))
      }
      await tx.savingsPlan.update({ where: { id: plan.id }, data: { balance: { increment: totalAmt } } })
      return txns
    })
  } catch (e) {
    if (e instanceof InsufficientFundsError) return insufficientResponse(e)
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
