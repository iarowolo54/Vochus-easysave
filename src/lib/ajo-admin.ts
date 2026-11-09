// Ajo: what staff can do when a running group gets stuck. Both run in one transaction with their audit entry.
//   replaceMember  — someone new takes over a member's turn and remaining payments. What the old member paid in comes
//                    out of that turn's pot and goes back to them. A member who has already collected can't be replaced.
//   stopAndRefund  — closes the group. Each payment made for the open turn goes back to whoever made it, as an ended
//                    plan they collect the normal way. Earlier turns have already been paid out, so they aren't touched.
import type { PrismaClient } from '@prisma/client'
import { openRound, roundLabel, type AjoCadence } from '@/lib/ajo'
import { createAjoPlan } from '@/lib/ajo-settle'
import { customerType } from '@/lib/customer-type'
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
      if (await tx.ajoPayout.count({ where: { groupId: g.id, memberId: m.id } })) return fail(409, 'This member has already had their turn, so they can’t be replaced. You can stop the group instead.')
      if (m.owedToCustomerId) return fail(409, 'This place has already been handed over once. Stop the group instead.')
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

export async function stopAndRefund(client: PrismaClient, input: { groupId: string; note: string; actor: Actor }): Promise<StaffResult> {
  return client.$transaction(async tx => {
    const g = await tx.ajoGroup.findUnique({
      where: { id: input.groupId },
      select: { id: true, name: true, size: true, cadence: true, startDate: true, payouts: { select: { round: true } }, members: { select: { id: true, customerId: true } } },
    })
    if (!g) return fail(404, 'Group not found')
    // Conditional, so two staff (or a double tap) can't refund twice.
    const now = new Date()
    const claimed = await tx.ajoGroup.updateMany({ where: { id: g.id, status: 'Running' }, data: { status: 'Stopped', stoppedAt: now, stopReason: input.note } })
    if (claimed.count === 0) return fail(409, 'Only a running group can be stopped.')

    const round = openRound(g.size, g.payouts.map(p => p.round))
    const paid = round ? await tx.ajoContribution.findMany({ where: { groupId: g.id, round, refundPlanId: null }, select: { id: true, ref: true, amount: true, memberId: true } }) : []
    // The money goes back to whoever actually paid, even if that person has since been replaced.
    const payers = await tx.transaction.findMany({ where: { ref: { in: paid.map(c => c.ref) } }, select: { ref: true, customerId: true } })
    const payerOf = new Map(payers.map(t => [t.ref, t.customerId]))
    const label = round ? roundLabel(g.startDate, g.cadence as AjoCadence, round) : ''
    const refunds = new Map<string, number>()
    for (const c of paid) {
      const customerId = payerOf.get(c.ref)
      if (!customerId) throw new Error(`Ajo contribution ${c.id} has no payer`)
      const who = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, select: { savingsPlans: { select: { source: true } } } })
      const plan = await createAjoPlan(tx, { customerId, online: customerType(who.savingsPlans) === 'online', goal: `Ajo refund · ${g.name}, ${label}`, amount: c.amount, notes: `ajo-refund:${g.id}:${round}` })
      await tx.ajoContribution.update({ where: { id: c.id }, data: { refundPlanId: plan.id, refundedAt: now } })
      refunds.set(customerId, money((refunds.get(customerId) ?? 0) + c.amount))
    }
    for (const m of g.members) await notify(tx, notifications.ajoStopped({ memberId: m.id, customerId: m.customerId, groupId: g.id, groupName: g.name, refund: refunds.get(m.customerId) ?? 0 }))
    const total = money([...refunds.values()].reduce((s, v) => s + v, 0))
    await tx.auditLog.create({ data: { action: 'ajo_group_stopped', entity: 'AjoGroup', entityId: g.id, actorType: 'admin', ...input.actor, details: `Ajo group "${g.name}" stopped; ₦${total} from ${paid.length} payment(s) for the open turn returned to the people who paid. Reason: ${input.note}` } })
    return { ok: true } as StaffResult
  })
}
