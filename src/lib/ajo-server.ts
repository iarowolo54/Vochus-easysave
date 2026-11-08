// Ajo: server-only helpers (join codes, loading a group, joining). Pure rules are in ajo.ts.
import { randomInt } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { customerType } from '@/lib/customer-type'
import { displayName } from '@/lib/format'
import { openRound, potOf, roundDueDay, roundLabel, type AjoCadence } from '@/lib/ajo'
import { notifications, notify } from '@/lib/notifications'

/** Six digits, cryptographically random. Callers retry on the (unique) clash. */
export function newJoinCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002'
}

/** The signed-in, active agent, or null. Authorization is always from the session, never the request. */
export async function sessionAgent() {
  const session = await getServerSession(authOptions)
  // Fail closed: an undefined filter would match the first agent in the table.
  const agentId = session?.user?.agentId
  if (typeof agentId !== 'string' || !agentId) return null
  const agent = await prisma.agent.findUnique({
    where: { agentId },
    select: { id: true, agentId: true, name: true, status: true },
  })
  return agent && agent.status === 'Active' ? agent : null
}

export class AjoFullError extends Error {}
export class AjoClosedError extends Error {}

/**
 * Add a customer to a Forming group. Re-checked inside the transaction, so two people joining at once can't
 * push the group past its size. Throws AjoClosedError / AjoFullError, or P2002 when they are already in it.
 */
export async function addMember(client: PrismaClient, groupId: string, customerId: string) {
  return client.$transaction(async tx => {
    const g = await tx.ajoGroup.findUnique({ where: { id: groupId }, select: { status: true, size: true, name: true, agentId: true } })
    if (!g || g.status !== 'Forming') throw new AjoClosedError()
    // notify: ajoJoined
    const m = await tx.ajoMember.create({ data: { groupId, customerId }, select: { id: true, customer: { select: { firstName: true, lastName: true } } } })
    const count = await tx.ajoMember.count({ where: { groupId } })
    if (count > g.size) throw new AjoFullError()
    await notify(tx, notifications.ajoJoined({ memberId: m.id, agentId: g.agentId, groupId, groupName: g.name, memberName: `${m.customer.firstName} ${m.customer.lastName}`, count, size: g.size }))
    return m
  })
}

const memberSelect = {
  id: true, slot: true, joinedAt: true, customerId: true,
  customer: { select: { customerId: true, firstName: true, lastName: true, phone: true, savingsPlans: { select: { source: true } } } },
} satisfies Prisma.AjoMemberSelect

/** Everything a group screen needs: members, each round's label, due day, holder, who has paid, and its payout. */
export async function loadGroup(client: PrismaClient | Prisma.TransactionClient, where: Prisma.AjoGroupWhereInput) {
  const g = await client.ajoGroup.findFirst({
    where,
    include: {
      members: { select: memberSelect, orderBy: { joinedAt: 'asc' } },
      contributions: { select: { memberId: true, round: true, method: true, createdAt: true } },
      payouts: { select: { round: true, memberId: true, amount: true, savingsPlanId: true, createdAt: true } },
    },
  })
  if (!g) return null
  const cadence = g.cadence as AjoCadence
  const paidOut = g.payouts.map(p => p.round)
  const current = g.status === 'Running' ? openRound(g.size, paidOut) : null
  const members = g.members.map(m => ({
    id: m.id,
    slot: m.slot,
    customerDbId: m.customerId,
    customerCode: m.customer.customerId,
    name: displayName(`${m.customer.firstName} ${m.customer.lastName}`),
    phone: m.customer.phone,
    type: customerType(m.customer.savingsPlans),
  }))
  const rounds = Array.from({ length: g.size }, (_, i) => {
    const round = i + 1
    const payout = g.payouts.find(p => p.round === round) ?? null
    return {
      round,
      label: roundLabel(g.startDate, cadence, round),
      dueDay: roundDueDay(g.startDate, cadence, round),
      holderId: g.members.find(m => m.slot === round)?.id ?? null,
      paid: g.contributions.filter(c => c.round === round).map(c => ({ memberId: c.memberId, method: c.method, at: c.createdAt })),
      payout: payout && { memberId: payout.memberId, amount: payout.amount, at: payout.createdAt, savingsPlanId: payout.savingsPlanId },
    }
  })
  return {
    id: g.id, code: g.code, name: g.name, agentId: g.agentId, cadence, size: g.size, contribution: g.contribution,
    pot: potOf(g), startDate: g.startDate, status: g.status, createdAt: g.createdAt, lockedAt: g.lockedAt, completedAt: g.completedAt,
    currentRound: current, members, rounds,
  }
}
export type AjoGroupView = NonNullable<Awaited<ReturnType<typeof loadGroup>>>

/** The member's-eye view of a group: names and who has paid, never phones or customer codes. */
export function memberView(g: AjoGroupView, customerDbId: string) {
  const me = g.members.find(m => m.customerDbId === customerDbId) ?? null
  return {
    id: g.id, name: g.name, cadence: g.cadence, size: g.size, contribution: g.contribution, pot: g.pot, startDate: g.startDate,
    status: g.status, currentRound: g.currentRound, memberCount: g.members.length,
    me: me && { memberId: me.id, slot: me.slot, payoutPlanId: me.slot ? g.rounds[me.slot - 1]?.payout?.savingsPlanId ?? null : null },
    members: g.members.map(m => ({ id: m.id, name: m.name, slot: m.slot, isMe: m.id === me?.id })),
    rounds: g.rounds.map(r => ({ round: r.round, label: r.label, dueDay: r.dueDay, holderId: r.holderId, paidMemberIds: r.paid.map(p => p.memberId), paidOut: !!r.payout })),
  }
}
