import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { dailyAmount, periodDays, goal, cadence } = await req.json()
  if (!dailyAmount || !periodDays) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  const da = parseFloat(dailyAmount)
  const pd = parseInt(periodDays)
  if (!isFinite(da) || da <= 0) return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 })
  if (!isFinite(pd) || pd <= 0) return NextResponse.json({ error: 'Duration must be a positive number of days' }, { status: 400 })

  const startDate = new Date()
  const maturityDate = new Date(startDate)
  maturityDate.setDate(maturityDate.getDate() + parseInt(periodDays))

  const plan = await prisma.savingsPlan.create({
    data: {
      customerId: customer.id,
      dailyAmount: da,
      periodDays: pd,
      cadence: cadence ?? 'daily',
      source: 'self',
      goal: goal ?? 'General Savings',
      startDate,
      maturityDate,
      balance: 0,
      status: 'Active',
    },
  })

  logAudit({
    action: 'customer_plan_create',
    entity: 'SavingsPlan',
    entityId: plan.id,
    details: `Customer ${customer.firstName} ${customer.lastName} (${customer.customerId}) created plan ${goal ?? 'General Savings'} — ₦${plan.dailyAmount}/${plan.cadence} x ${plan.periodDays} days`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: `${customer.firstName} ${customer.lastName}`,
  })

  return NextResponse.json({ plan })
}
