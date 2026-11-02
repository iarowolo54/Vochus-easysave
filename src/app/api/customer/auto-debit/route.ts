import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { nextPaymentDate } from '@/lib/pay-ahead'

export async function GET(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const planId = req.nextUrl.searchParams.get('planId')
  if (!planId) return NextResponse.json({ error: 'planId required' }, { status: 400 })

  // Owner in the where: another customer's plan is indistinguishable from a missing one.
  const plan = await prisma.savingsPlan.findFirst({
    where: { id: planId, customerId: session.id },
    select: { id: true, cadence: true, status: true, dailyAmount: true, startDate: true, maturityDate: true },
  })
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const mandate = await prisma.autoDebitMandate.findFirst({
    where: { savingsPlanId: plan.id, customerId: session.id },
    select: { status: true, amountPerCycle: true, nextRunAt: true, last4: true, bankName: true },
  })
  if (!mandate) return NextResponse.json({ status: 'none' })

  let nextPaymentAt: Date | null = null
  if (mandate.status === 'active') {
    const coverage = await prisma.planDayCoverage.findMany({ where: { savingsPlanId: plan.id }, select: { coversKey: true } })
    nextPaymentAt = nextPaymentDate({ plan, nextRunAt: mandate.nextRunAt, coveredKeys: coverage.map(c => c.coversKey), now: new Date() })
  }
  return NextResponse.json({ ...mandate, nextPaymentAt })
}
