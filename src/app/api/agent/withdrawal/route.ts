import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { IN_FLIGHT_WITHDRAWAL_STATUSES } from '@/lib/redemption-statuses'
import { logAudit } from '@/lib/audit'
import { assertSufficient, insufficientResponse, InsufficientFundsError, money } from '@/lib/wallet-guard'
import { debitAgentBalance } from '@/lib/wallet-debit'
import { getPayoutMode } from '@/lib/payout-mode'
import { notifySuperAdminsAgentWithdrawal } from '@/lib/payout-notify'

const MIN_WITHDRAWAL = 1

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({
    where: { agentId: session.user.agentId },
    select: { id: true, commissionBalance: true, bankCode: true, bankName: true, accountNumber: true, accountName: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const withdrawals = await prisma.agentWithdrawal.findMany({
    where: { agentId: agent.id },
    orderBy: { requestedAt: 'desc' },
  })

  return NextResponse.json({
    commissionBalance: agent.commissionBalance,
    bank: agent.accountNumber
      ? { bankCode: agent.bankCode, bankName: agent.bankName, accountNumber: agent.accountNumber, accountName: agent.accountName }
      : null,
    minWithdrawal: MIN_WITHDRAWAL,
    withdrawals,
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { amount: rawAmount, note } = await req.json()
  let amount = money(parseFloat(rawAmount))
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })

  if (!agent.accountNumber || !agent.bankCode || !agent.bankName) {
    return NextResponse.json({ error: 'Add your payout bank account in Settings before requesting a withdrawal.' }, { status: 400 })
  }

  const balance = money(agent.commissionBalance)
  if (amount > balance && amount - balance <= 0.01) amount = balance

  try {
    assertSufficient('Commission balance', balance, amount)
  } catch (e) {
    if (e instanceof InsufficientFundsError) return insufficientResponse(e)
    throw e
  }

  const pendingExisting = await prisma.agentWithdrawal.count({
    where: { agentId: agent.id, status: { in: IN_FLIGHT_WITHDRAWAL_STATUSES } },
  })
  if (pendingExisting > 0) return NextResponse.json({ error: 'You already have a pending withdrawal. Wait for admin decision before requesting another.' }, { status: 400 })

  const count = await prisma.agentWithdrawal.count()
  const ref = `AWD-${String(count + 1).padStart(5, '0')}`

  let record
  try {
    record = await prisma.$transaction(async (tx) => {
      // Atomically hold the commission; concurrent requests can't overdraw it.
      const debited = await debitAgentBalance(tx, agent.id, 'commissionBalance', amount)
      if (!debited) throw new InsufficientFundsError('Commission balance', balance, amount)
      // notify: none — the agent made this request on this screen; they hear when it is paid or declined
      return tx.agentWithdrawal.create({
        data: {
          ref,
          agentId: agent.id,
          amount,
          note: note || null,
          status: 'Pending',
          payoutMethod: 'BankTransfer',
          bankCode: agent.bankCode,
          bankName: agent.bankName,
          accountNumber: agent.accountNumber,
          accountName: agent.accountName,
        },
      })
    })
  } catch (e) {
    if (e instanceof InsufficientFundsError) return insufficientResponse(e)
    throw e
  }

  logAudit({
    action: 'agent_withdrawal_request',
    entity: 'AgentWithdrawal',
    entityId: record.id,
    details: `${agent.name} (${agent.agentId}) requested ₦${amount} commission payout to ${agent.bankName} ****${agent.accountNumber.slice(-4)}`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  // Manual mode only: alert super admins to pay this out. Must never break request creation.
  try {
    if ((await getPayoutMode()).agent === 'manual') {
      await notifySuperAdminsAgentWithdrawal(prisma, { agentName: agent.name, amountNaira: amount, ref: record.ref })
    }
  } catch (e) {
    console.error('[agent-withdrawal] admin notification failed', e instanceof Error ? e.message : e)
  }

  return NextResponse.json({ withdrawal: record }, { status: 201 })
}
