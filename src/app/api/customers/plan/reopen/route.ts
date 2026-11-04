import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { reopenPlan, REOPEN_COLLECTING, REOPEN_NOT_FINISHED, REOPEN_NOT_FOUND } from '@/lib/plan-reopen'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body: unknown = await req.json().catch(() => null)
  const { customerId, planId } = (body && typeof body === 'object' ? body : {}) as { customerId?: unknown; planId?: unknown }
  if (typeof customerId !== 'string' || typeof planId !== 'string' || !customerId || !planId) {
    return NextResponse.json({ error: 'Missing customer or plan' }, { status: 400 })
  }

  // The customer must be this agent's own.
  const customer = await prisma.customer.findFirst({ where: { id: customerId, agentId: agent.id }, select: { id: true, firstName: true, lastName: true } })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const result = await reopenPlan(prisma, { planId, customerId: customer.id })
  if (!result.ok) {
    if (result.reason === 'not_found') return NextResponse.json({ error: REOPEN_NOT_FOUND }, { status: 404 })
    if (result.reason === 'collecting') return NextResponse.json({ error: REOPEN_COLLECTING }, { status: 409 })
    return NextResponse.json({ error: REOPEN_NOT_FINISHED }, { status: 409 })
  }

  logAudit({
    action: 'agent_plan_reopen',
    entity: 'SavingsPlan',
    entityId: result.planId,
    details: `Agent ${agent.name} reopened plan ${result.planId} for ${customer.firstName} ${customer.lastName}`,
    actorId: agent.id,
    actorName: agent.name,
  })
  return NextResponse.json({ planId: result.planId })
}
