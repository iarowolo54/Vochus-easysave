// Ajo notices for the nightly sweep (src/lib/notification-sweep.ts):
//   backfill  — rebuilds the last 48 h of live Ajo notices with the same dedupe keys, so a missed write is filled in;
//   scheduled — due reminders: each unpaid member of the open round on its due day and weekly after; the agent the day
//               after it was due and weekly after.
import type { PrismaClient } from '@prisma/client'
import { notifications as N, type NotificationEvent } from '@/lib/notifications'
import { lagosDay, openRound, roundDueDay, roundLabel, type AjoCadence } from '@/lib/ajo'
import { formatDate } from '@/lib/format'

const DAY = 86_400_000
const daysBetween = (fromDay: string, toDay: string) => Math.round((Date.parse(toDay) - Date.parse(fromDay)) / DAY)

export type DueGroup = {
  id: string; name: string; agentId: string; cadence: string; size: number; contribution: number; startDate: Date
  paidOutRounds: number[]
  members: { id: string; customerId: string }[]
  paid: { memberId: string; round: number }[]
}

/** Reminders for the open round of each running group (pure). */
export function ajoDueEvents(groups: DueGroup[], now: Date): NotificationEvent[] {
  const today = lagosDay(now)
  const out: NotificationEvent[] = []
  for (const g of groups) {
    const round = openRound(g.size, g.paidOutRounds)
    if (round === null) continue
    const cadence = g.cadence as AjoCadence
    const due = roundDueDay(g.startDate, cadence, round)
    const late = daysBetween(due, today)
    if (late < 0) continue
    const label = roundLabel(g.startDate, cadence, round)
    const paid = new Set(g.paid.filter(p => p.round === round).map(p => p.memberId))
    const unpaid = g.members.filter(m => !paid.has(m.id))
    for (const m of unpaid) {
      out.push(...N.ajoDue({ memberId: m.id, customerId: m.customerId, groupId: g.id, groupName: g.name, round, roundLabel: label, amount: g.contribution, week: Math.floor(late / 7) }))
    }
    if (late >= 1) out.push(...N.ajoLate({ groupId: g.id, agentId: g.agentId, groupName: g.name, round, roundLabel: label, unpaid: unpaid.length, week: Math.floor((late - 1) / 7) }))
  }
  return out
}

/** Every Ajo notice due now: the last 48 h rebuilt, plus today's reminders. */
export async function ajoSweepEvents(client: PrismaClient, since: Date, now: Date): Promise<{ backfill: NotificationEvent[]; scheduled: NotificationEvent[] }> {
  const group = { select: { id: true, name: true, agentId: true, cadence: true, startDate: true, size: true } } as const
  const person = { select: { firstName: true, lastName: true } } as const
  const [contributions, payouts, joins, started, running] = await Promise.all([
    client.ajoContribution.findMany({ where: { createdAt: { gte: since } }, select: { ref: true, round: true, amount: true, method: true, createdAt: true, group, member: { select: { customerId: true, customer: person } } } }),
    client.ajoPayout.findMany({ where: { createdAt: { gte: since } }, select: { round: true, amount: true, savingsPlanId: true, createdAt: true, groupId: true, group: { select: { ...group.select, members: { select: { id: true, customerId: true, customer: person } } } } } }),
    client.ajoMember.findMany({ where: { joinedAt: { gte: since } }, select: { id: true, customer: person, group: { select: { ...group.select, _count: { select: { members: true } } } } } }),
    client.ajoGroup.findMany({ where: { lockedAt: { gte: since } }, select: { ...group.select, members: { select: { id: true, slot: true, customerId: true } } } }),
    client.ajoGroup.findMany({ where: { status: 'Running' }, select: { ...group.select, contribution: true, payouts: { select: { round: true } }, members: { select: { id: true, customerId: true } }, contributions: { select: { memberId: true, round: true } } } }),
  ])
  const full = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`
  const backfill: NotificationEvent[] = []
  for (const c of contributions) {
    backfill.push(...N.ajoPaid({
      ref: c.ref, customerId: c.member.customerId, agentId: c.group.agentId, groupId: c.group.id, groupName: c.group.name, memberName: full(c.member.customer),
      roundLabel: roundLabel(c.group.startDate, c.group.cadence as AjoCadence, c.round), amount: c.amount, byTransfer: c.method === 'transfer', at: c.createdAt,
    }))
  }
  for (const p of payouts) {
    const label = roundLabel(p.group.startDate, p.group.cadence as AjoCadence, p.round)
    const plan = await client.savingsPlan.findUnique({ where: { id: p.savingsPlanId }, select: { id: true, goal: true, customerId: true } })
    const who = p.group.members.find(m => m.customerId === plan?.customerId)
    if (plan) backfill.push(...N.planEnded({ planId: plan.id, customerId: plan.customerId, goal: plan.goal, ajo: true }).map(e => ({ ...e, at: p.createdAt })))
    backfill.push(...N.ajoRoundOut({ groupId: p.groupId, round: p.round, agentId: p.group.agentId, groupName: p.group.name, roundLabel: label, holderName: who ? full(who.customer) : 'The member', amount: p.amount, at: p.createdAt }))
  }
  for (const j of joins) {
    backfill.push(...N.ajoJoined({ memberId: j.id, agentId: j.group.agentId, groupId: j.group.id, groupName: j.group.name, memberName: full(j.customer), count: j.group._count.members, size: j.group.size }))
  }
  for (const g of started) {
    const cadence = g.cadence as AjoCadence
    const firstDue = formatDate(new Date(`${roundDueDay(g.startDate, cadence, 1)}T12:00:00+01:00`))
    for (const m of g.members) if (m.slot) backfill.push(...N.ajoStarted({ memberId: m.id, customerId: m.customerId, groupId: g.id, groupName: g.name, slotLabel: roundLabel(g.startDate, cadence, m.slot), firstDue }))
  }
  const replaced = await client.ajoMember.findMany({ where: { replacedAt: { gte: since }, owedToCustomerId: { not: null } }, select: { id: true, slot: true, customerId: true, owedToCustomerId: true, owedAmount: true, group: group } })
  for (const m of replaced) {
    if (m.slot) backfill.push(...N.ajoReplaced({ memberId: m.id, newCustomerId: m.customerId, oldCustomerId: m.owedToCustomerId!, groupId: m.group.id, groupName: m.group.name, turnLabel: roundLabel(m.group.startDate, m.group.cadence as AjoCadence, m.slot), owed: m.owedAmount }))
  }
  const scheduled = ajoDueEvents(running.map(g => ({ ...g, paidOutRounds: g.payouts.map(p => p.round), paid: g.contributions })), now)
  return { backfill, scheduled }
}
