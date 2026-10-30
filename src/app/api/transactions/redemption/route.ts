import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { assertSufficient, insufficientResponse, InsufficientFundsError, money } from '@/lib/wallet-guard'
import { redemptionDeduction, planHasCashDeposit, getStoredCommissionRates } from '@/lib/wallet-rates'
import { loadOwnedRedeemablePlan, claimPlanForRedemption } from '@/lib/redemption'
import { accruedInterestForPlan } from '@/lib/savings-interest-plan'
import { interestPayoutOps } from '@/lib/redemption-interest-ops'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()
  const { customerId, planId, method } = body

  if (!customerId || !planId) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  // Ownership-scoped: an agent may only redeem plans belonging to their OWN
  // customers (closes the cross-agent IDOR). Also filters to redeemable plans.
  const plan = await loadOwnedRedeemablePlan(agent.id, customerId, planId)
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const gross = money(plan.balance)
  const hasCashDeposit = await planHasCashDeposit(prisma, plan.id)
  const commRates = await getStoredCommissionRates(prisma)
  const rates = redemptionDeduction({ balance: plan.balance, dailyAmount: plan.dailyAmount, cadence: plan.cadence, hasCashDeposit, periodDays: plan.periodDays, initiator: 'admin', commRates, source: (plan as any).source })
  const platformFee = money(rates.platform)
  const agentComm = money(rates.agent)
  // Live interest (0 unless source === 'self'); paid from the Revenue wallet inside the claim transaction.
  const interest = await accruedInterestForPlan(prisma, plan, new Date())
  const netPayout = money(gross - platformFee - agentComm + interest)

  const txnCount = await prisma.transaction.count()
  const ref = `TXN-${String(9000 + txnCount + 1)}`
  const walletAfter = agent.walletBalance + netPayout

  let txn
  try {
    txn = await prisma.$transaction(async (tx) => {
      // Atomically claim the plan at the exact balance the payout was computed
      // from; a losing/stale concurrent call must not credit.
      const won = await claimPlanForRedemption(tx, planId, plan.balance)
      if (!won) throw new Error('ALREADY_REDEEMED')
      const created = await tx.transaction.create({
        data: {
          ref,
          agentId: agent.id,
          customerId,
          planId,
          type: 'redemption',
          amount: netPayout,
          method: method ?? 'Cash',
          status: 'Done',
          walletAfter,
        },
      })
      await tx.platformWallet.upsert({
        where: { type: 'Revenue' },
        update: { balance: { increment: platformFee } },
        create: { type: 'Revenue', balance: platformFee },
      })
      await tx.agent.update({
        where: { id: agent.id },
        data: {
          walletBalance: { increment: netPayout },
          commissionBalance: { increment: agentComm },
        },
      })
      for (const op of interestPayoutOps(tx, { ref, interestAmount: interest, savingsPlanId: plan.id }, agent.id, customerId)) await op
      return created
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'ALREADY_REDEEMED') {
      return NextResponse.json({ error: 'Plan already redeemed' }, { status: 409 })
    }
    throw e
  }

  logAudit({
    action: 'redemption',
    entity: 'Transaction',
    entityId: txn.id,
    details: `Redemption ₦${gross} gross → ₦${netPayout} net payout for plan ${plan.id} (fee ₦${money(platformFee + agentComm)})`,
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ transaction: txn, gross, platformFee, agentComm, netPayout })
}
