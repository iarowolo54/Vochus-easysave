import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { getFlexibleSettings } from '@/lib/flexible-savings'
import { findIdentityConflict } from '@/lib/identity'
import { identityConflictResponse } from '@/lib/identity-response'
import { parseRequestBody, parseStoredPlans, pendingConflictMessage } from '@/lib/customer-request'
import { emailRequestSubmitted } from '@/lib/customer-request-email'
import { requireAgent } from '../_agent'

type Ctx = { params: Promise<{ id: string }> }

/** One of the agent's own requests, to fill the form again after a denial. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requireAgent()
  if (!guard.ok) return guard.response
  const { id } = await params
  const r = await prisma.customerRequest.findFirst({ where: { id, agentId: guard.agent.id } })
  if (!r) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  return NextResponse.json({
    id: r.id, status: r.status, firstName: r.firstName, lastName: r.lastName, phone: r.phone, email: r.email,
    dob: r.dob, address: r.address, language: r.language, gender: r.gender, state: r.state, lga: r.lga, bvn: r.bvn,
    nokName: r.nokName, nokRelation: r.nokRelation, nokPhone: r.nokPhone, photoUrl: r.photoUrl, nfcCard: r.nfcCard,
    denyReason: r.denyReason, denyFix: r.denyFix, plans: parseStoredPlans(r.plans),
  })
}

/** Resend a denied request after fixing it. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const guard = await requireAgent()
  if (!guard.ok) return guard.response
  const { agent } = guard
  const { id } = await params

  const body: unknown = await req.json().catch(() => null)
  const parsed = parseRequestBody(body, await getFlexibleSettings(prisma))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const conflict = await findIdentityConflict(prisma, { phone: parsed.value.phone, email: parsed.value.email })
  if (conflict) return identityConflictResponse(conflict)

  try {
    // notify: none — the agent is on the screen that confirms it; the super admin is told by email below
    const updated = await prisma.customerRequest.updateMany({
      where: { id, agentId: agent.id, status: 'Denied' },
      data: { ...parsed.value, status: 'Pending', submittedAt: new Date(), denyReason: null, denyFix: null, decidedAt: null, decidedBy: null, decidedById: null },
    })
    if (updated.count !== 1) return NextResponse.json({ error: 'This request can’t be changed now.' }, { status: 409 })
  } catch (e) {
    const message = pendingConflictMessage(e)
    if (message) return NextResponse.json({ error: message }, { status: 409 })
    throw e
  }

  const customerName = `${parsed.value.firstName} ${parsed.value.lastName}`
  logAudit({ action: 'customer_request_resubmitted', entity: 'CustomerRequest', entityId: id, details: `Customer request sent again for ${customerName}`, actorId: agent.id, actorName: agent.name })
  void emailRequestSubmitted(prisma, { customerName, agentName: agent.name, agentCode: agent.agentId, resubmitted: true })
  return NextResponse.json({ id })
}
