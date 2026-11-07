import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { listedStatuses } from '@/lib/receipt-payout'
import { isHandCredit } from '@/lib/hand-receipt'

export async function GET() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const transactions = await prisma.transaction.findMany({
    where: { customerId: session.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { plan: { select: { goal: true, cadence: true } } },
  })

  const statuses = await listedStatuses(transactions)

  return NextResponse.json({
    transactions: transactions.map(t => ({
      id: t.id,
      ref: t.ref,
      type: t.type,
      amount: t.amount,
      feeTaken: t.feeTaken,
      method: t.method,
      confirmedByStaff: isHandCredit(t.note),
      status: statuses.get(t.id) ?? t.status,
      createdAt: t.createdAt,
      planGoal: t.plan?.goal ?? null,
      cadence: t.plan?.cadence ?? null,
    })),
  })
}
