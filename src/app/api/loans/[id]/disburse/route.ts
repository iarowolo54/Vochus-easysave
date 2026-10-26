import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { LOAN_AGENT_COMMISSION, LOAN_PLATFORM_FEE } from '@/lib/wallet-rates'

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
  if (agent.walletBalance < loan.principal) {
    return NextResponse.json({ error: 'Insufficient wallet balance' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const method = body.method ?? 'Cash'

  const agentComm = loan.principal * LOAN_AGENT_COMMISSION
  const platformRevenue = loan.interestAmount * LOAN_PLATFORM_FEE

  const txnCount = await prisma.transaction.count()
  const ref = `DSB-${String(txnCount + 1).padStart(5, '0')}`
  const walletAfter = agent.walletBalance - loan.principal

  await prisma.$transaction([
    prisma.loan.update({ where: { id: loan.id }, data: { status: 'Disbursed' } }),
    prisma.agent.update({
      where: { id: agent.id },
      data: {
        walletBalance: { decrement: loan.principal },
        commissionBalance: { increment: agentComm },
      },
    }),
    prisma.platformWallet.upsert({
      where: { type: 'Revenue' },
      update: { balance: { increment: platformRevenue } },
      create: { type: 'Revenue', balance: platformRevenue },
    }),
    prisma.transaction.create({
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
    }),
  ])

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
