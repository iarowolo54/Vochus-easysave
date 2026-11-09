import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { sessionAgent } from '@/lib/ajo-server'
import { isEveryMember } from '@/lib/ajo'

type Ctx = { params: Promise<{ id: string }> }

const MEMBERS_CHANGED = 'The members have changed. Check the list and arrange them again.'

/** The agent sets who redeems first, second and so on. Allowed until the group starts. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const agent = await sessionAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const group = await prisma.ajoGroup.findFirst({ where: { id, agentId: agent.id }, select: { id: true, name: true } })
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body: unknown = await req.json().catch(() => null)
  const memberIds = body && typeof body === 'object' ? (body as { memberIds?: unknown }).memberIds : undefined

  const result = await prisma.$transaction(async tx => {
    // Writing first holds the database, so the group can't start and members can't change while the turns are saved.
    const forming = await tx.ajoGroup.updateMany({ where: { id: group.id, status: 'Forming' }, data: { status: 'Forming' } })
    if (forming.count !== 1) return { error: 'This group has already started, so turns can’t change.' }
    const members = await tx.ajoMember.findMany({ where: { groupId: group.id }, select: { id: true, customer: { select: { customerId: true } } } })
    if (!isEveryMember(memberIds, members.map(m => m.id))) return { error: MEMBERS_CHANGED }
    // Cleared first: each group's turn numbers must stay unique at every step.
    await tx.ajoMember.updateMany({ where: { groupId: group.id }, data: { slot: null } })
    for (const [i, memberId] of memberIds.entries()) await tx.ajoMember.update({ where: { id: memberId }, data: { slot: i + 1 } })
    return { order: memberIds.map(mid => members.find(m => m.id === mid)!.customer.customerId) }
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 409 })

  logAudit({ action: 'ajo_turns_arranged', entity: 'AjoGroup', entityId: group.id, details: `Agent ${agent.name} (${agent.agentId}) arranged the turns of Ajo group "${group.name}": ${result.order.join(', ')}`, actorType: 'agent', actorId: agent.id, actorName: agent.name })
  return NextResponse.json({ ok: true })
}
