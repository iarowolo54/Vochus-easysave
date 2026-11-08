import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { checkSlots } from '@/lib/ajo'
import { sessionAgent } from '@/lib/ajo-server'

type Ctx = { params: Promise<{ id: string }> }

/** Set who collects which round: { slots: { [memberId]: round } } covering every member. Only before the group starts. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const agent = await sessionAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const group = await prisma.ajoGroup.findFirst({ where: { id, agentId: agent.id }, select: { id: true, name: true, size: true, status: true, members: { select: { id: true } } } })
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (group.status !== 'Forming') return NextResponse.json({ error: 'This group has started, so slots can’t change.' }, { status: 409 })

  const body: unknown = await req.json().catch(() => null)
  const raw = body && typeof body === 'object' ? (body as { slots?: unknown }).slots : undefined
  const check = checkSlots(group.members.map(m => m.id), group.size, raw && typeof raw === 'object' ? raw as Record<string, unknown> : {})
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  const ok = await prisma.$transaction(async tx => {
    if (!(await tx.ajoGroup.count({ where: { id: group.id, status: 'Forming' } }))) return false
    // Clear first: each slot is unique within the group, so a swap would otherwise clash halfway.
    await tx.ajoMember.updateMany({ where: { groupId: group.id }, data: { slot: null } })
    for (const [memberId, slot] of check.slots) await tx.ajoMember.update({ where: { id: memberId }, data: { slot } })
    return true
  })
  if (!ok) return NextResponse.json({ error: 'This group has started, so slots can’t change.' }, { status: 409 })
  logAudit({ action: 'ajo_slots_set', entity: 'AjoGroup', entityId: group.id, details: `Agent ${agent.name} set the collection order for Ajo group "${group.name}"`, actorType: 'agent', actorId: agent.id, actorName: agent.name })
  return NextResponse.json({ ok: true })
}
