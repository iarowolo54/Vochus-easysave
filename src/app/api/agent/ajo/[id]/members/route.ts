import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { customerType } from '@/lib/customer-type'
import { AjoClosedError, AjoFullError, addMember, isUniqueViolation, sessionAgent } from '@/lib/ajo-server'

type Ctx = { params: Promise<{ id: string }> }

/** The agent adds one of their own customers (usually a cash customer, who can't join with the code). */
export async function POST(req: NextRequest, { params }: Ctx) {
  const agent = await sessionAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const group = await prisma.ajoGroup.findFirst({ where: { id, agentId: agent.id }, select: { id: true, name: true } })
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body: unknown = await req.json().catch(() => null)
  const customerId = body && typeof body === 'object' ? (body as { customerId?: unknown }).customerId : undefined
  if (typeof customerId !== 'string' || !customerId) return NextResponse.json({ error: 'Choose a customer.' }, { status: 400 })
  const customer = await prisma.customer.findFirst({ where: { id: customerId, agentId: agent.id }, select: { id: true, firstName: true, lastName: true, customerId: true, status: true } })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  if (customer.status !== 'Active') return NextResponse.json({ error: 'This customer’s account isn’t active.' }, { status: 409 })

  try {
    await addMember(prisma, group.id, customer.id)
  } catch (e) {
    if (isUniqueViolation(e)) return NextResponse.json({ error: 'They are already in this group.' }, { status: 409 })
    if (e instanceof AjoFullError) return NextResponse.json({ error: 'The group is full.' }, { status: 409 })
    if (e instanceof AjoClosedError) return NextResponse.json({ error: 'This group has started, so no one can join now.' }, { status: 409 })
    throw e
  }
  logAudit({ action: 'ajo_member_added', entity: 'AjoGroup', entityId: group.id, details: `Agent ${agent.name} added ${customer.firstName} ${customer.lastName} (${customer.customerId}) to Ajo group "${group.name}"`, actorType: 'agent', actorId: agent.id, actorName: agent.name })
  return NextResponse.json({ ok: true })
}

/** Remove a member before the group starts. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const agent = await sessionAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const memberId = req.nextUrl.searchParams.get('memberId') ?? ''
  const group = await prisma.ajoGroup.findFirst({ where: { id, agentId: agent.id }, select: { id: true, name: true, status: true } })
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (group.status !== 'Forming') return NextResponse.json({ error: 'This group has started, so members can’t be removed.' }, { status: 409 })
  // Online members leave for themselves. If an agent could remove them, removing and re-adding would change who is first.
  const target = await prisma.ajoMember.findFirst({ where: { id: memberId, groupId: group.id }, select: { customer: { select: { savingsPlans: { select: { source: true } } } } } })
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (customerType(target.customer.savingsPlans) === 'online') return NextResponse.json({ error: 'Online members leave the group themselves.' }, { status: 403 })
  const gone = await prisma.$transaction(async tx => {
    // Re-checked inside the write: the group must still be forming.
    const still = await tx.ajoGroup.count({ where: { id: group.id, status: 'Forming' } })
    if (!still) return 0
    return (await tx.ajoMember.deleteMany({ where: { id: memberId, groupId: group.id } })).count
  })
  if (!gone) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  logAudit({ action: 'ajo_member_removed', entity: 'AjoGroup', entityId: group.id, details: `Agent ${agent.name} removed a member from Ajo group "${group.name}" before it started`, actorType: 'agent', actorId: agent.id, actorName: agent.name })
  return NextResponse.json({ ok: true })
}
