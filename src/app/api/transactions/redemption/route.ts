import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { assertSufficient, insufficientResponse, InsufficientFundsError, money } from '@/lib/wallet-guard'
import { redemptionDeduction, planHasCashDeposit, getStoredCommissionRates } from '@/lib/wallet-rates'

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

  const plan = await prisma.savingsPlan.findFirst({ where: { id: planId, customerId } })
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  if (plan.balance <= 0) return NextResponse.json({ error: 'No balance to redeem' }, { status: 400 })

  const gross = money(plan.balance)
  const hasCashDeposit = await planHasCashDeposit(prisma, plan.id)
  const commRates = await getStoredCommissionRates(prisma)
  const rates = redemptionDeduction({ balance: plan.balance, dailyAmount: plan.dailyAmount, cadence: plan.cadence, hasCashDeposit, periodDays: plan.periodDays, initiator: 'admin', commRates, source: (plan as any).source })
  const platformFee = money(rates.platform)
  const agentComm = money(rates.agent)
  const netPayout = money(gross - platformFee - agentComm)

  const txnCount = await prisma.transaction.count()
  const ref = `TXN-${String(9000 + txnCount + 1)}`
  const walletAfter = agent.walletBalance + netPayout

  const [txn] = await prisma.$transaction([
    prisma.transaction.create({
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
    }),
    prisma.savingsPlan.update({
      where: { id: planId },
      data: { balance: 0, status: 'Redeemed' },
    }),
    prisma.platformWallet.upsert({
      where: { type: 'Revenue' },
      update: { balance: { increment: platformFee } },
      create: { type: 'Revenue', balance: platformFee },
    }),
    prisma.agent.update({
      where: { id: agent.id },
      data: {
        walletBalance: { increment: netPayout },
        commissionBalance: { increment: agentComm },
      },
    }),
  ])

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
