import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
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
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: unknown = await req.json().catch(() => null)
  const { planId, resetId, code } = (body && typeof body === 'object' ? body : {}) as { planId?: unknown; resetId?: unknown; code?: unknown }
  if (typeof planId !== 'string' || !planId) return NextResponse.json({ error: 'Missing plan' }, { status: 400 })
  // The customer must confirm with the code texted to them. It is used up here, and only after the plan is known to be reopenable.
  if (typeof resetId !== 'string' || typeof code !== 'string') return NextResponse.json({ error: REOPEN_CODE_INVALID }, { status: 400 })
  const check = await checkReopenable(prisma, { planId, customerId: session.id })
  if (!check.ok) return failure(check.reason)
  if (!(await confirmReopenCode(session.id, planId, resetId, code.trim()))) return NextResponse.json({ error: REOPEN_CODE_INVALID }, { status: 400 })

  const result = await reopenPlan(prisma, { planId, customerId: session.id })
  if (!result.ok) return failure(result.reason)

  logAudit({
    action: 'customer_plan_reopen',
    entity: 'SavingsPlan',
    entityId: result.planId,
    details: `Customer ${session.name} reopened plan ${result.planId} to save into it again, confirmed with the code texted to them`,
    actorType: 'customer',
    actorId: session.id,
    actorName: session.name,
  })
  return NextResponse.json({ planId: result.planId })
}
