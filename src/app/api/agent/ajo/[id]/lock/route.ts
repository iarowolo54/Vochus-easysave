import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { sessionAgent } from '@/lib/ajo-server'
import { roundDueDay, roundLabel, type AjoCadence } from '@/lib/ajo'
import { notifications as N, notify } from '@/lib/notifications'
import { formatDate } from '@/lib/format'

type Ctx = { params: Promise<{ id: string }> }

/** Start the group: it must be full and every member must have a slot. After this nothing about membership changes. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const agent = await sessionAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const group = await prisma.ajoGroup.findFirst({ where: { id, agentId: agent.id }, select: { id: true, name: true, size: true, status: true, cadence: true, startDate: true } })
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (group.status !== 'Forming') return NextResponse.json({ error: 'This group has already started.' }, { status: 409 })

  const result = await prisma.$transaction(async tx => {
    const members = await tx.ajoMember.findMany({ where: { groupId: group.id }, select: { id: true, slot: true, customerId: true } })
    if (members.length !== group.size) return `The group needs ${group.size} members. It has ${members.length}.`
    if (members.some(m => m.slot === null)) return 'Give every member a slot first.'
    const done = await tx.ajoGroup.updateMany({ where: { id: group.id, status: 'Forming' }, data: { status: 'Running', lockedAt: new Date() } })
    if (done.count !== 1) return 'This group has already started.'
    const cadence = group.cadence as AjoCadence
    const firstDue = formatDate(new Date(`${roundDueDay(group.startDate, cadence, 1)}T12:00:00+01:00`))
    for (const m of members) {
      await notify(tx, N.ajoStarted({ memberId: m.id, customerId: m.customerId, groupId: group.id, groupName: group.name, slotLabel: roundLabel(group.startDate, cadence, m.slot!), firstDue }))
    }
    return null
  })
  if (result) return NextResponse.json({ error: result }, { status: 409 })
  logAudit({ action: 'ajo_group_started', entity: 'AjoGroup', entityId: group.id, details: `Agent ${agent.name} started Ajo group "${group.name}"`, actorType: 'agent', actorId: agent.id, actorName: agent.name })
  return NextResponse.json({ ok: true })
}
