// Ajo: what staff can do when a running group gets stuck. A group can't be stopped (owner's decision): the way out is
// replaceMember, in one transaction with its audit entry. Someone new takes over a member's turn and remaining payments.
// What the old member paid in comes out of that turn's pot and goes back to them. A member who has already collected
// can't be replaced.
import type { PrismaClient } from '@prisma/client'
import { roundLabel, type AjoCadence } from '@/lib/ajo'
import { notifications, notify } from '@/lib/notifications'
import { money } from '@/lib/wallet-guard'

export type Actor = { actorId?: string; actorName: string }
export type StaffResult = { ok: true } | { ok: false; status: number; error: string }
const fail = (status: number, error: string): StaffResult => ({ ok: false, status, error })

export async function replaceMember(client: PrismaClient, input: { groupId: string; memberId: string; customerCode: string; note: string; actor: Actor }): Promise<StaffResult> {
  try {
    return await client.$transaction(async tx => {
      const g = await tx.ajoGroup.findUnique({ where: { id: input.groupId }, select: { id: true, name: true, status: true, agentId: true, cadence: true, startDate: true } })
      if (!g) return fail(404, 'Group not found')
      if (g.status !== 'Running') return fail(409, 'Only a running group can have a member replaced.')
      const m = await tx.ajoMember.findFirst({ where: { id: input.memberId, groupId: g.id }, select: { id: true, slot: true, customerId: true, owedToCustomerId: true, customer: { select: { firstName: true, lastName: true, customerId: true } } } })
      if (!m || !m.slot) return fail(404, 'Member not found')
      if (await tx.ajoPayout.count({ where: { groupId: g.id, memberId: m.id } })) return fail(409, 'This member has already had their turn, so they can’t be replaced.')
      if (m.owedToCustomerId) return fail(409, 'This place has already been handed over once.')
      const next = await tx.customer.findFirst({ where: { customerId: input.customerCode, agentId: g.agentId }, select: { id: true, status: true, firstName: true, lastName: true, customerId: true } })
      if (!next) return fail(404, 'No customer with that ID belongs to this group’s agent.')
      if (next.status !== 'Active') return fail(409, 'That customer’s account isn’t active.')
      if (await tx.ajoMember.count({ where: { groupId: g.id, customerId: next.id } })) return fail(409, 'That customer is already in this group.')

      const paid = await tx.ajoContribution.findMany({ where: { memberId: m.id }, select: { amount: true } })
      const owed = money(paid.reduce((s, c) => s + c.amount, 0))
      await tx.ajoMember.update({ where: { id: m.id }, data: { customerId: next.id, replacedAt: new Date(), ...(owed > 0 ? { owedToCustomerId: m.customerId, owedAmount: owed } : {}) } })
      await notify(tx, notifications.ajoReplaced({ memberId: m.id, newCustomerId: next.id, oldCustomerId: m.customerId, groupId: g.id, groupName: g.name, turnLabel: roundLabel(g.startDate, g.cadence as AjoCadence, m.slot), owed }))
      await tx.auditLog.create({ data: {
        action: 'ajo_member_replaced', entity: 'AjoGroup', entityId: g.id, actorType: 'admin', ...input.actor,
        details: `${m.customer.firstName} ${m.customer.lastName} (${m.customer.customerId}) replaced by ${next.firstName} ${next.lastName} (${next.customerId}) in Ajo group "${g.name}", turn ${m.slot}. ₦${owed} goes back to the old member from that turn’s pot. Reason: ${input.note}`,
      } })
      return { ok: true } as StaffResult
    })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return fail(409, 'That customer is already in this group.')
    throw e
  }
}
