import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { customerId, dailyAmount, periodDays, goal, startDate, cadence, notes } = await req.json()
  if (!customerId || !dailyAmount || !periodDays || !goal) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const customer = await prisma.customer.findFirst({ where: { id: customerId, agentId: agent.id } })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const start = startDate ? new Date(startDate) : new Date()
  const maturity = new Date(start)
  maturity.setDate(maturity.getDate() + parseInt(periodDays))

  const plan = await prisma.savingsPlan.create({
    data: {
      customerId: customer.id,
      dailyAmount: parseFloat(dailyAmount),
      periodDays: parseInt(periodDays),
      goal,
      cadence: cadence ?? 'daily',
      startDate: start,
      maturityDate: maturity,
      balance: 0,
      notes: notes || null,
    },
  })

  const txnCount = await prisma.transaction.count()
  const ref = `ENR-${String(txnCount + 1).padStart(5, '0')}`

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
    details: `Agent ${agent.name} (${agent.agentId}) created plan for ${customer.firstName} ${customer.lastName} (${customer.customerId}) — ₦${dailyAmount}/${cadence ?? 'daily'} × ${periodDays} days`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })

  return NextResponse.json({ plan }, { status: 201 })
}
