import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { getCommissionRates } from '@/lib/commission-rates'
import { loanCommissionAmounts, recordCommission } from '@/lib/commission-ledger'
import { debitAgentBalance } from '@/lib/wallet-debit'
import { customerHasOtherDisbursedLoan } from '@/lib/loan-eligibility'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const loan = await prisma.loan.findFirst({ where: { id, agentId: agent.id } })
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  if (loan.status !== 'Approved') {
    return NextResponse.json({ error: 'Only admin-approved loans can be disbursed' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const method = body.method ?? 'Cash'

  const rates = await getCommissionRates(prisma)
  const { agent: agentComm, platform: platformRevenue } = loanCommissionAmounts(rates, loan.principal, loan.interestAmount)

  const txnCount = await prisma.transaction.count()
  const ref = `DSB-${String(txnCount + 1).padStart(5, '0')}`
  const walletAfter = agent.walletBalance - loan.principal

  try {
    await prisma.$transaction(async (tx) => {
      // One loan at a time: refuse if the customer already has a Disbursed loan.
      // Enforced here (not just at request time) so a request-time race that
      // produced two Approved loans can't pay out twice for the same customer.
      if (loan.customerId && await customerHasOtherDisbursedLoan(tx, loan.customerId, loan.id)) {
        throw new Error('ALREADY_DISBURSED')
      }
      // Atomically claim the loan: only an Approved loan transitions, exactly once.
      const claimed = await tx.loan.updateMany({ where: { id: loan.id, status: 'Approved' }, data: { status: 'Disbursed' } })
      if (claimed.count === 0) throw new Error('NOT_CLAIMABLE')
      // Atomically debit the agent's wallet (no overdraw / double-disburse).
      const debited = await debitAgentBalance(tx, agent.id, 'walletBalance', loan.principal)
      if (!debited) throw new Error('INSUFFICIENT')
      await tx.agent.update({ where: { id: agent.id }, data: { commissionBalance: { increment: agentComm } } })
      await tx.platformWallet.upsert({
        where: { type: 'Revenue' },
        update: { balance: { increment: platformRevenue } },
        create: { type: 'Revenue', balance: platformRevenue },
      })
      await recordCommission(tx, { party: 'agent', agentId: agent.id, source: 'loan', sourceRef: ref, customerId: loan.customerId, base: loan.principal, ratePct: rates.agentLoan, amount: agentComm })
      await recordCommission(tx, { party: 'platform', agentId: null, source: 'loan', sourceRef: ref, customerId: loan.customerId, base: loan.interestAmount, ratePct: rates.platformLoan, amount: platformRevenue })
      await tx.transaction.create({
        data: {
          ref,
          agentId: agent.id,
          customerId: loan.customerId,
          type: 'disbursement',
          amount: loan.principal,
          method,
          status: 'Done',
          walletAfter,
        },
      })
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'ALREADY_DISBURSED') {
      return NextResponse.json({ error: 'This customer already has a loan out. It must be repaid before another can be disbursed.' }, { status: 409 })
    }
    if (e instanceof Error && e.message === 'NOT_CLAIMABLE') {
      return NextResponse.json({ error: 'Loan already disbursed' }, { status: 409 })
    }
    if (e instanceof Error && e.message === 'INSUFFICIENT') {
      return NextResponse.json({ error: 'Insufficient wallet balance' }, { status: 400 })
    }
    throw e
  }

  logAudit({
    action: 'loan_disburse',
    entity: 'Loan',
    entityId: loan.id,
    details: `Disbursed loan ${loan.ref} ₦${loan.principal} via ${method} (txn ${ref})`,
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ success: true })
}
