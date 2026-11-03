import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { getCommissionRates } from '@/lib/commission-rates'
import { recordCommission, repaymentCommissionAmount } from '@/lib/commission-ledger'
import { money } from '@/lib/wallet-guard'

class RepayRefused extends Error {}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const loan = await prisma.loan.findFirst({ where: { id, agentId: agent.id } })
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  if (loan.status !== 'Disbursed') {
    return NextResponse.json({ error: 'Loan not eligible for repayment' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const method = typeof body?.method === 'string' && body.method ? body.method : 'Cash'
  const amt = parseFloat(body?.amount)
  if (!isFinite(amt) || amt <= 0) return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 })

  const rates = await getCommissionRates(prisma)
  const repayComm = repaymentCommissionAmount(rates, amt)

  let ref = ''
  let outstanding = 0
  let fullyRepaid = false
  try {
    await prisma.$transaction(async (tx) => {
      // Checked inside the transaction, so concurrent repayments can't overpay the loan.
      const current = await tx.loan.findFirst({
        where: { id, agentId: agent.id, status: 'Disbursed' },
        include: { repayments: { select: { amount: true } } },
      })
      if (!current) throw new RepayRefused('Loan not eligible for repayment')
      const totalRepaid = current.repayments.reduce((s, r) => s + r.amount, 0)
      outstanding = money(current.totalAmount - totalRepaid)
      if (amt > outstanding) throw new RepayRefused('Amount exceeds outstanding balance')
      fullyRepaid = money(totalRepaid + amt) >= money(current.totalAmount)

      const txnCount = await tx.transaction.count()
      ref = `RPY-${String(txnCount + 1).padStart(5, '0')}`

      await tx.loanRepayment.create({ data: { loanId: current.id, amount: amt, method } })
      await tx.transaction.create({
        data: { ref, agentId: agent.id, customerId: current.customerId, type: 'repayment', amount: amt, method, status: 'Done' },
      })
      await tx.agent.update({
        where: { id: agent.id },
        data: { walletBalance: { increment: amt }, commissionBalance: { increment: repayComm } },
      })
      await recordCommission(tx, { party: 'agent', agentId: agent.id, source: 'repayment', sourceRef: ref, customerId: current.customerId, base: amt, ratePct: rates.agentRepay, amount: repayComm })
      if (fullyRepaid) await tx.loan.update({ where: { id: current.id }, data: { status: 'Repaid' } })
    })
  } catch (e) {
    if (e instanceof RepayRefused) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  logAudit({
    action: 'loan_repay',
    entity: 'Loan',
    entityId: loan.id,
    details: `Repayment ₦${amt} on loan ${loan.ref} via ${method} (txn ${ref})${fullyRepaid ? ' — fully repaid' : ''}`,
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ success: true, fullyRepaid, outstanding: money(outstanding - amt) })
}
