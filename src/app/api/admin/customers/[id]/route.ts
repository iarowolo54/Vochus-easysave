import { NextRequest, NextResponse } from 'next/server'
import { requirePermission, resolveAdminAccess } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

// Full view of one customer: profile, next of kin, every plan and each plan's transactions.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('customers', 'view')
  if (!guard.ok) return guard.response

  const { id } = await params
  // Transactions are the transactions screen's data: show them only to actors who can open it.
  const canSeeTxns = (await resolveAdminAccess('transactions', 'view')).ok
  const txnSelect = canSeeTxns ? { orderBy: { createdAt: 'desc' as const }, take: 200, select: { id: true, ref: true, type: true, amount: true, method: true, status: true, note: true, feeTaken: true, createdAt: true } } : undefined
  const c = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true, dob: true, nokName: true, nokRelation: true, nokPhone: true, emailVerifiedAt: true, walletBalance: true,
      savingsPlans: {
        orderBy: { startDate: 'desc' },
        select: {
          id: true, goal: true, dailyAmount: true, periodDays: true, cadence: true, source: true,
          startDate: true, maturityDate: true, balance: true, status: true, interestAccrued: true,
          ...(txnSelect ? { transactions: txnSelect } : {}),
        },
      },
    },
  })
  if (!c) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  // Transactions that belong to no plan (e.g. enrolment, wallet funding).
  const other = !canSeeTxns ? [] : await prisma.transaction.findMany({
    where: { customerId: id, planId: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, ref: true, type: true, amount: true, method: true, status: true, note: true, feeTaken: true, createdAt: true },
  })

  return NextResponse.json({
    dob: c.dob,
    nokName: c.nokName,
    nokRelation: c.nokRelation,
    nokPhone: c.nokPhone,
    emailVerified: c.emailVerifiedAt != null,
    transactionsHidden: !canSeeTxns,
    plans: c.savingsPlans.map(p => ({ ...p, transactions: 'transactions' in p ? p.transactions : [] })),
    otherTransactions: other,
  })
}
