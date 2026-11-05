import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { confirmReopenCode, REOPEN_CODE_INVALID } from '@/lib/plan-reopen-code'
import { checkReopenable, reopenPlan, REOPEN_COLLECTING, REOPEN_NOT_FINISHED, REOPEN_NOT_FOUND } from '@/lib/plan-reopen'

function failure(reason: 'not_found' | 'not_finished' | 'collecting') {
  if (reason === 'not_found') return NextResponse.json({ error: REOPEN_NOT_FOUND }, { status: 404 })
  if (reason === 'collecting') return NextResponse.json({ error: REOPEN_COLLECTING }, { status: 409 })
  return NextResponse.json({ error: REOPEN_NOT_FINISHED }, { status: 409 })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body: unknown = await req.json().catch(() => null)
  const { customerId, planId, resetId, code } = (body && typeof body === 'object' ? body : {}) as { customerId?: unknown; planId?: unknown; resetId?: unknown; code?: unknown }
  if (typeof customerId !== 'string' || typeof planId !== 'string' || !customerId || !planId) {
    return NextResponse.json({ error: 'Missing customer or plan' }, { status: 400 })
  }

  // The customer must be this agent's own.
  const customer = await prisma.customer.findFirst({ where: { id: customerId, agentId: agent.id }, select: { id: true, firstName: true, lastName: true } })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  // The customer must have agreed: the code was texted to them and the agent types in what they read out.
  if (typeof resetId !== 'string' || typeof code !== 'string') return NextResponse.json({ error: REOPEN_CODE_INVALID }, { status: 400 })
  const check = await checkReopenable(prisma, { planId, customerId: customer.id })
  if (!check.ok) return failure(check.reason)
  if (!(await confirmReopenCode(customer.id, planId, resetId, code.trim()))) return NextResponse.json({ error: REOPEN_CODE_INVALID }, { status: 400 })

  const result = await reopenPlan(prisma, { planId, customerId: customer.id })
  if (!result.ok) return failure(result.reason)

  logAudit({
    action: 'agent_plan_reopen',
    entity: 'SavingsPlan',
    entityId: result.planId,
    details: `Agent ${agent.name} reopened plan ${result.planId} for ${customer.firstName} ${customer.lastName}, confirmed with the code texted to the customer`,
    actorId: agent.id,
    actorName: agent.name,
  })
  return NextResponse.json({ planId: result.planId })
}
