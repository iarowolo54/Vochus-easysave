import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { loadCycleState } from '@/lib/bulk-savings'
import { nextPaymentDate } from '@/lib/pay-ahead'
import { cycleAmount } from '@/lib/auto-debit-schedule'

export async function GET(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const planId = req.nextUrl.searchParams.get('planId')
  if (!planId) return NextResponse.json({ error: 'planId required' }, { status: 400 })

  // Owner in the where: another customer's plan is indistinguishable from a missing one.
  const plan = await prisma.savingsPlan.findFirst({
    where: { id: planId, customerId: session.id },
    select: { id: true, cadence: true, status: true, dailyAmount: true, periodDays: true, startDate: true, maturityDate: true },
  })
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const mandate = await prisma.autoDebitMandate.findFirst({
    where: { savingsPlanId: plan.id, customerId: session.id },
    select: { status: true, amountPerCycle: true, nextRunAt: true, last4: true, bankName: true },
  })
  if (!mandate) return NextResponse.json({ status: 'none' })

  let nextPaymentAt: Date | null = null
  if (mandate.status === 'active') {
    const { coveredKeys, plainDeposits } = await loadCycleState(prisma, plan.id)
    nextPaymentAt = nextPaymentDate({ plan, nextRunAt: mandate.nextRunAt, coveredKeys, plainDeposits, now: new Date() })
  }
  // What the next charge will be, from the same rule the cron uses, rather than the amount stored at signup.
  return NextResponse.json({ ...mandate, amountPerCycle: cycleAmount(plan), nextPaymentAt })
}
