import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { sessionAgent } from '@/lib/ajo-server'
import { arrangedOrder, roundDueDay, roundLabel, type AjoCadence } from '@/lib/ajo'
import { notifications as N, notify } from '@/lib/notifications'
import { formatDate } from '@/lib/format'
import { getAjoFee } from '@/lib/ajo-fee'

type Ctx = { params: Promise<{ id: string }> }

class NotStartable extends Error {}

/** Start the group once it is full, in the turn order the agent saw on screen. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const agent = await sessionAgent()
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const group = await prisma.ajoGroup.findFirst({ where: { id, agentId: agent.id }, select: { id: true, name: true, size: true, status: true, cadence: true, startDate: true } })
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (group.status !== 'Forming') return NextResponse.json({ error: 'This group has already started.' }, { status: 409 })

  const body: unknown = await req.json().catch(() => null)
  const seen = body && typeof body === 'object' ? (body as { memberIds?: unknown }).memberIds : undefined

  let order: string[]
  try {
    order = await prisma.$transaction(async tx => {
      // The Platform Fee is locked here: changing the setting later doesn't touch a group that has started.
      const fee = await getAjoFee(tx)
      // Writing first holds the database, so members and turns can't change between this check and the start.
      const done = await tx.ajoGroup.updateMany({ where: { id: group.id, status: 'Forming' }, data: { status: 'Running', lockedAt: new Date(), feePct: fee.feePct, feeAgentSharePct: fee.agentSharePct } })
      if (done.count !== 1) throw new NotStartable('This group has already started.')
      const rows = await tx.ajoMember.findMany({ where: { groupId: group.id }, select: { id: true, joinedAt: true, slot: true, customerId: true, customer: { select: { customerId: true } } } })
      if (rows.length !== group.size) throw new NotStartable(`The group needs ${group.size} members. It has ${rows.length}.`)
      const members = arrangedOrder(rows)
      if (!Array.isArray(seen) || seen.length !== members.length || members.some((m, i) => m.id !== seen[i])) throw new NotStartable('The members have changed. Check the list, then start the group.')
      const cadence = group.cadence as AjoCadence
      const firstDue = formatDate(new Date(`${roundDueDay(group.startDate, cadence, 1)}T12:00:00+01:00`))
      await tx.ajoMember.updateMany({ where: { groupId: group.id }, data: { slot: null } })
      for (const [i, m] of members.entries()) {
        const slot = i + 1
        await tx.ajoMember.update({ where: { id: m.id }, data: { slot } })
        await notify(tx, N.ajoStarted({ memberId: m.id, customerId: m.customerId, groupId: group.id, groupName: group.name, slotLabel: roundLabel(group.startDate, cadence, slot), firstDue }))
      }
      return members.map(m => m.customer.customerId)
    })
  } catch (e) {
    if (e instanceof NotStartable) return NextResponse.json({ error: e.message }, { status: 409 })
    throw e
  }
  logAudit({ action: 'ajo_group_started', entity: 'AjoGroup', entityId: group.id, details: `Agent ${agent.name} started Ajo group "${group.name}". Turns: ${order.join(', ')}`, actorType: 'agent', actorId: agent.id, actorName: agent.name })
  return NextResponse.json({ ok: true })
}
