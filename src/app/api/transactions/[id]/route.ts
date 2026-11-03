import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canSendReceipt, receiptStatus } from '@/lib/receipt-message'
import { loadPayoutOutcome } from '@/lib/receipt-payout'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { id } = await params
  const txn = await prisma.transaction.findFirst({
    where: { id, agentId: agent.id },
    include: { customer: true, plan: true },
  })
  if (!txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  const payout = await loadPayoutOutcome(txn)

  return NextResponse.json({
    id: txn.id,
    ref: txn.ref,
    type: txn.type,
    amount: txn.amount,
    method: txn.method,
    status: txn.status,
    receiptStatus: receiptStatus({ status: txn.status, payout }),
    canSendReceipt: canSendReceipt(payout),
    note: txn.note,
    createdAt: txn.createdAt,
    agent: { name: agent.name, agentId: agent.agentId },
    customer: txn.customer
      ? {
          name: `${txn.customer.firstName} ${txn.customer.lastName}`,
          customerId: txn.customer.customerId,
          phone: txn.customer.phone,
        }
      : null,
    plan: txn.plan ? { goal: txn.plan.goal, durationDays: txn.plan.periodDays } : null,
  })
}
