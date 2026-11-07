import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { genTxnRef } from '@/lib/ref'
import { logAudit } from '@/lib/audit'
import { BAD_CADENCE, flexiblePlanData, getFlexibleSettings, isFlexible, parseCadence, shortDate, type FlexiblePlanData } from '@/lib/flexible-savings'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { customerId, dailyAmount, periodDays, goal, startDate, endDate, cadence, notes } = await req.json()
  const cad = parseCadence(cadence)
  if (!cad) return NextResponse.json({ error: BAD_CADENCE }, { status: 400 })
  const flexible = isFlexible(cad)
  if (!customerId || !goal || (!flexible && (!dailyAmount || !periodDays))) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  let flex: FlexiblePlanData | null = null
  if (flexible) {
    const r = flexiblePlanData({ startDate, endDate }, await getFlexibleSettings(prisma))
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
    flex = r
  }

  const customer = await prisma.customer.findFirst({ where: { id: customerId, agentId: agent.id } })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const start = startDate ? new Date(startDate) : new Date()
  const maturity = new Date(start)
  maturity.setDate(maturity.getDate() + parseInt(periodDays))

  const plan = await prisma.savingsPlan.create({
    data: {
      customerId: customer.id,
      ...(flex ?? { dailyAmount: parseFloat(dailyAmount), periodDays: parseInt(periodDays), cadence: cad, startDate: start, maturityDate: maturity }),
      goal,
      balance: 0,
      notes: notes || null,
    },
  })

  // Collision-safe ref — a count-based ENR-<n> collides when two plans are
  // created at once and 500s on the unique Transaction.ref (#17).
  const ref = genTxnRef('ENR')

  await prisma.transaction.create({
    data: {
      ref,
      agentId: agent.id,
      customerId: customer.id,
      planId: plan.id,
      type: 'enrolment',
      amount: 0,
      method: 'Cash',
      status: 'Done',
    },
  })

  logAudit({
    action: 'plan_created',
    entity: 'SavingsPlan',
    entityId: plan.id,
    details: `Agent ${agent.name} (${agent.agentId}) created plan for ${customer.firstName} ${customer.lastName} (${customer.customerId}) — ${flex ? `flexible, ${shortDate(flex.startDate)} to ${shortDate(flex.maturityDate)}` : `₦${dailyAmount}/${cad} × ${periodDays} days`}`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ plan }, { status: 201 })
}
