import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAgent } from '@/app/api/customers/requests/_agent'
import { eligibilityError, findBlockers, parseUpgradeBody, submitUpgradeRequest } from '@/lib/agent-upgrade'
import { emailAdminsWaiting } from '@/lib/agent-upgrade-email'

type Ctx = { params: Promise<{ id: string }> }

/** What the Make agent form needs: the customer's details to pre-fill, whether they can be converted, and anything still open. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requireAgent()
  if (!guard.ok) return guard.response
  const { id } = await params
  const c = await prisma.customer.findFirst({
    where: { id, agentId: guard.agent.id },
    select: { id: true, customerId: true, firstName: true, lastName: true, phone: true, email: true, address: true, state: true, lga: true, nokName: true, nokPhone: true, type: true, status: true, convertedToAgentId: true },
  })
  if (!c) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 })
  const open = await prisma.agentUpgradeRequest.findFirst({ where: { customerId: c.id, status: 'Pending' }, select: { id: true, status: true } })
  // Only whether a password is set, never the hash.
  const hasPassword = (await prisma.customer.count({ where: { id: c.id, password: { not: null } } })) === 1
  return NextResponse.json({
    customer: c,
    notEligible: eligibilityError({ ...c, password: hasPassword ? 'set' : null }),
    blockers: await findBlockers(prisma, c.id),
    open,
  })
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireAgent()
  if (!guard.ok) return guard.response
  const { id } = await params
  const parsed = parseUpgradeBody(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const r = await submitUpgradeRequest(prisma, { agent: guard.agent, customerId: id, fields: parsed.value })
  if (!r.ok) return NextResponse.json({ error: r.error, blockers: r.blockers }, { status: r.status })
  void emailAdminsWaiting(prisma, { customerName: r.customerName, agentName: guard.agent.name, agentCode: guard.agent.agentId, resubmitted: false })
  return NextResponse.json({ id: r.id }, { status: 201 })
}
