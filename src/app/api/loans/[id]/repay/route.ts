import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { LOAN_REPAY_AGENT_COMMISSION } from '@/lib/wallet-rates'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const loan = await prisma.loan.findFirst({
    where: { id, agentId: agent.id },
    include: { repayments: true },
  })
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  if (!['Disbursed', 'Approved'].includes(loan.status)) {
    return NextResponse.json({ error: 'Loan not eligible for repayment' }, { status: 400 })
  }

  const body = await req.json()
  const { amount, method } = body
  const amt = parseFloat(amount)
  if (!isFinite(amt) || amt <= 0) return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 })

  const totalRepaid = loan.repayments.reduce((s, r) => s + r.amount, 0)
  const outstanding = loan.totalAmount - totalRepaid
  if (amt > outstanding) return NextResponse.json({ error: 'Amount exceeds outstanding balance' }, { status: 400 })

  const txnCount = await prisma.transaction.count()
  const ref = `RPY-${String(txnCount + 1).padStart(5, '0')}`

  const newRepaid = totalRepaid + amt
  const fullyRepaid = newRepaid >= loan.totalAmount
  const repayComm = amt * LOAN_REPAY_AGENT_COMMISSION

  await prisma.$transaction([
    prisma.loanRepayment.create({
      data: { loanId: loan.id, amount: amt, method: method ?? 'Cash' },
    }),
    prisma.transaction.create({
      data: {
        ref,
        agentId: agent.id,
        customerId: loan.customerId,
        type: 'repayment',
        amount: amt,
        method: method ?? 'Cash',
        status: 'Done',
      },
    }),
    prisma.agent.update({
      where: { id: agent.id },
      data: {
        walletBalance: { increment: amt },
        commissionBalance: { increment: repayComm },
      },
    }),
    ...(fullyRepaid
      ? [prisma.loan.update({ where: { id: loan.id }, data: { status: 'Repaid' } })]
      : []),
  ])

  logAudit({
    action: 'loan_repay',
    entity: 'Loan',
    entityId: loan.id,
    details: `Repayment ₦${amt} on loan ${loan.ref} via ${method ?? 'Cash'} (txn ${ref})${fullyRepaid ? ' — fully repaid' : ''}`,
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ success: true, fullyRepaid, outstanding: outstanding - amt })
}
