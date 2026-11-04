import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { reopenPlan, REOPEN_COLLECTING, REOPEN_NOT_FINISHED, REOPEN_NOT_FOUND } from '@/lib/plan-reopen'

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: unknown = await req.json().catch(() => null)
  const planId = body && typeof body === 'object' ? (body as { planId?: unknown }).planId : undefined
  if (typeof planId !== 'string' || !planId) return NextResponse.json({ error: 'Missing plan' }, { status: 400 })

  const result = await reopenPlan(prisma, { planId, customerId: session.id })
  if (!result.ok) {
    if (result.reason === 'not_found') return NextResponse.json({ error: REOPEN_NOT_FOUND }, { status: 404 })
    if (result.reason === 'collecting') return NextResponse.json({ error: REOPEN_COLLECTING }, { status: 409 })
    return NextResponse.json({ error: REOPEN_NOT_FINISHED }, { status: 409 })
  }

  logAudit({
    action: 'customer_plan_reopen',
    entity: 'SavingsPlan',
    entityId: result.planId,
    details: `Customer ${session.name} reopened plan ${result.planId} to save into it again`,
    actorType: 'customer',
    actorId: session.id,
    actorName: session.name,
  })
  return NextResponse.json({ planId: result.planId })
}
