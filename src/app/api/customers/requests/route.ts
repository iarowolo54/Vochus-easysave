import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { getFlexibleSettings } from '@/lib/flexible-savings'
import { findIdentityConflict } from '@/lib/identity'
import { identityConflictResponse } from '@/lib/identity-response'
import { parseRequestBody, pendingConflictMessage } from '@/lib/customer-request'
import { emailRequestSubmitted } from '@/lib/customer-request-email'
import { requireAgent } from './_agent'

export async function GET() {
  const guard = await requireAgent()
  if (!guard.ok) return guard.response
  // No photo here: a list of base64 images would run to several MB.
  const requests = await prisma.customerRequest.findMany({
    where: { agentId: guard.agent.id, status: { not: 'Cancelled' } },
    orderBy: { submittedAt: 'desc' },
    take: 100,
    select: { id: true, status: true, firstName: true, lastName: true, phone: true, submittedAt: true, decidedAt: true, denyReason: true, denyFix: true, customerCode: true },
  })
  return NextResponse.json({ requests })
}

export async function POST(req: NextRequest) {
  const guard = await requireAgent()
  if (!guard.ok) return guard.response
  const { agent } = guard

  const body: unknown = await req.json().catch(() => null)
  const parsed = parseRequestBody(body, await getFlexibleSettings(prisma))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const conflict = await findIdentityConflict(prisma, { phone: parsed.value.phone, email: parsed.value.email })
  if (conflict) return identityConflictResponse(conflict)

  try {
    // notify: none — the agent is on the screen that confirms it; the super admin is told by email below
    const created = await prisma.customerRequest.create({ data: { ...parsed.value, agentId: agent.id }, select: { id: true } })
    const customerName = `${parsed.value.firstName} ${parsed.value.lastName}`
    logAudit({ action: 'customer_request_submitted', entity: 'CustomerRequest', entityId: created.id, details: `Customer request submitted for ${customerName}`, actorId: agent.id, actorName: agent.name })
    void emailRequestSubmitted(prisma, { customerName, agentName: agent.name, agentCode: agent.agentId, resubmitted: false })
    return NextResponse.json({ id: created.id }, { status: 201 })
  } catch (e) {
    const message = pendingConflictMessage(e)
    if (message) return NextResponse.json({ error: message }, { status: 409 })
    throw e
  }
}
