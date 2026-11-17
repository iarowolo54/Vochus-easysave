import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAgent } from '@/app/api/customers/requests/_agent'
import { cancelUpgradeRequest, findBlockers, parseUpgradeBody, resubmitUpgradeRequest } from '@/lib/agent-upgrade'
import { emailAdminsWaiting } from '@/lib/agent-upgrade-email'

type Ctx = { params: Promise<{ id: string }> }

/** One of the agent's own requests, to fix and resend. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requireAgent()
  if (!guard.ok) return guard.response
  const { id } = await params
  const r = await prisma.agentUpgradeRequest.findFirst({
    where: { id, agentId: guard.agent.id },
    select: {
      id: true, status: true, nin: true, bvn: true, state: true, lga: true, address: true, nokName: true, nokPhone: true, denyReason: true, denyFix: true,
      customer: { select: { id: true, firstName: true, lastName: true, customerId: true } },
    },
  })
  if (!r) return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
  return NextResponse.json({ request: r, blockers: r.status === 'Denied' ? await findBlockers(prisma, r.customer.id) : [] })
}

/** Resend a request that wasn't approved, with the fixes. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const guard = await requireAgent()
  if (!guard.ok) return guard.response
  const { id } = await params
  const parsed = parseUpgradeBody(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const r = await resubmitUpgradeRequest(prisma, { agent: guard.agent, id, fields: parsed.value })
  if (!r.ok) return NextResponse.json({ error: r.error, blockers: r.blockers }, { status: r.status })
  void emailAdminsWaiting(prisma, { customerName: r.customerName, agentName: guard.agent.name, agentCode: guard.agent.agentId, resubmitted: true })
  return NextResponse.json({ ok: true })
}

/** Cancel one of the agent's own requests, waiting or not approved. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const guard = await requireAgent()
  if (!guard.ok) return guard.response
  const { id } = await params
  const r = await cancelUpgradeRequest(prisma, { agent: guard.agent, id })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
