import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { asCustomerType, planCreationBlock } from '@/lib/customer-type'
import { BAD_CADENCE, flexiblePlanData, getFlexibleSettings, isFlexible, parseCadence, shortDate, type FlexiblePlanData } from '@/lib/flexible-savings'
import { resolvePlanStartDate, maturityFrom } from '@/lib/saving-plan'

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customer = await prisma.customer.findUnique({ where: { id: session.id } })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Offline (agent-registered) customers have their plans opened by their agent.
  const blocked = planCreationBlock('customer', asCustomerType(customer.type))
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 })

  const { dailyAmount, periodDays, goal, cadence, startDate, endDate } = await req.json()
  const cad = parseCadence(cadence)
  if (!cad) return NextResponse.json({ error: BAD_CADENCE }, { status: 400 })
  if (isFlexible(cad)) {
    const r = flexiblePlanData({ startDate, endDate }, await getFlexibleSettings(prisma))
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
    return createPlan(customer, r, goal)
  }
  if (!dailyAmount || !periodDays) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  const da = parseFloat(dailyAmount)
  const pd = parseInt(periodDays)
  if (!isFinite(da) || da <= 0) return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 })
  if (!isFinite(pd) || pd <= 0) return NextResponse.json({ error: 'Duration must be a positive number of days' }, { status: 400 })

  // Optional start date (today or later); defaults to today.
  const started = resolvePlanStartDate(startDate)
  if ('error' in started) return NextResponse.json({ error: started.error }, { status: 400 })
  const planStart = started.date
  const maturityDate = maturityFrom(planStart, pd)

  const plan = await prisma.savingsPlan.create({
    data: {
      customerId: customer.id,
      dailyAmount: da,
      periodDays: pd,
      cadence: cad,
      source: 'self',
      goal: goal ?? 'General Savings',
      startDate: planStart,
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

async function createPlan(customer: { id: string; firstName: string; lastName: string; customerId: string }, flex: FlexiblePlanData, goal: unknown) {
  const name = typeof goal === 'string' && goal.trim() ? goal.trim() : 'General Savings'
  const plan = await prisma.savingsPlan.create({
    data: { customerId: customer.id, ...flex, source: 'self', goal: name, balance: 0, status: 'Active' },
  })
  logAudit({
    action: 'customer_plan_create',
    entity: 'SavingsPlan',
    entityId: plan.id,
    details: `Customer ${customer.firstName} ${customer.lastName} (${customer.customerId}) created plan ${name} — flexible, ${shortDate(flex.startDate)} to ${shortDate(flex.maturityDate)}`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: `${customer.firstName} ${customer.lastName}`,
  })
  return NextResponse.json({ plan })
}
