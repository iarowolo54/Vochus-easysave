// Ajo money: recording a contribution and, when that completes a round, paying the pot out into the slot holder's
// payout plan. Everything here runs inside the caller's transaction; the unique keys are the race guards:
//   AjoContribution (memberId, round)  — a member pays a round once, however many alerts/clicks arrive;
//   AjoPayout (groupId, round)         — a round pays out once, whichever contribution completed it.
// A payout plan is an ended SavingsPlan (cadence 'ajo') holding the pot; the winner collects it through the normal
// collection flow (bank for online members, cash + code for cash members). No fee yet (group.feeRule 'none').
import { randomBytes } from 'node:crypto'
import type { PaymentIntent, Prisma, PrismaClient } from '@prisma/client'
import { AJO_PLAN_CADENCE, openRound, roundLabel, type AjoCadence } from '@/lib/ajo'
import { consumePaymentIntent, INTENT_PENDING, INTENT_REVIEW, recordManualCredit, type ManualActor } from '@/lib/payment-intent'
import { sendToReview, type SettleResult } from '@/lib/customer-settle'
import { asCustomerType, planSourceFor, type CustomerType } from '@/lib/customer-type'
import { logAudit } from '@/lib/audit'
import { money } from '@/lib/wallet-guard'
import { notifications, notify } from '@/lib/notifications'

type Tx = Prisma.TransactionClient

export class AjoRoundClosedError extends Error {}
export class AjoAlreadyPaidError extends Error {}

export const ajoRef = (kind: 'CON' | 'OUT') => `VCHS-AJO-${kind}-${Date.now()}-${randomBytes(5).toString('base64url').toUpperCase()}`

/** An ended plan holding Ajo money for one person, who collects it through the normal collection flow. */
export function createAjoPlan(tx: Tx, f: { customerId: string; type: CustomerType; goal: string; amount: number; notes: string }) {
  const now = new Date()
  return tx.savingsPlan.create({
    data: {
      customerId: f.customerId, cadence: AJO_PLAN_CADENCE,
      // Keeps the person's online/cash standing, which decides how the collection is paid.
      source: planSourceFor(f.type),
      goal: f.goal, dailyAmount: 0, periodDays: 0, startDate: now, maturityDate: now, balance: f.amount, status: 'Active', notes: f.notes,
    },
  })
}

export type PayoutDone = { round: number; memberId: string; customerId: string; amount: number; savingsPlanId: string; groupCompleted: boolean }

/** If every member has paid `round`, move the round's money into its holder's payout plan. Null when not yet. */
export async function completeRoundIfFunded(tx: Tx, groupId: string, round: number): Promise<PayoutDone | null> {
  const g = await tx.ajoGroup.findUnique({
    where: { id: groupId },
    select: {
      id: true, name: true, cadence: true, size: true, startDate: true, status: true,
      agentId: true,
      members: { select: { id: true, slot: true, customerId: true, owedToCustomerId: true, owedAmount: true, customer: { select: { firstName: true, lastName: true, type: true } } } },
    },
  })
  if (!g || g.status !== 'Running') return null
  const paid = await tx.ajoContribution.findMany({ where: { groupId, round }, select: { memberId: true, amount: true } })
  const paidIds = new Set(paid.map(p => p.memberId))
  if (!g.members.every(m => paidIds.has(m.id))) return null
  const holder = g.members.find(m => m.slot === round)
  if (!holder) throw new Error(`Ajo group ${groupId} has no holder for round ${round}`)

  // The whole round goes to the holder, extra kobo included, so nothing is left in the pool.
  const total = money(paid.reduce((s, p) => s + p.amount, 0))
  // If staff replaced this member, what the person before them paid in goes back to that person out of this pot.
  const owed = holder.owedToCustomerId ? money(Math.min(holder.owedAmount, total)) : 0
  const amount = money(total - owed)
  const now = new Date()
  const label = roundLabel(g.startDate, g.cadence as AjoCadence, round)
  const plan = await createAjoPlan(tx, { customerId: holder.customerId, type: asCustomerType(holder.customer.type), goal: `Ajo · ${g.name}, ${label}`, amount, notes: `ajo:${g.id}:${round}` })
  if (owed > 0) {
    const before = await tx.customer.findUniqueOrThrow({ where: { id: holder.owedToCustomerId! }, select: { type: true } })
    const back = await createAjoPlan(tx, { customerId: holder.owedToCustomerId!, type: asCustomerType(before.type), goal: `Ajo refund · ${g.name}, ${label}`, amount: owed, notes: `ajo-owed:${g.id}:${round}` })
    await notify(tx, notifications.planEnded({ planId: back.id, customerId: back.customerId, goal: back.goal, ajo: true }))
  }
  // Unique (groupId, round): if another contribution completed this round at the same moment, this throws and the
  // whole transaction (plan included) rolls back.
  // notify: ajoRoundOut
  await tx.ajoPayout.create({ data: { groupId, round, memberId: holder.id, amount: total, savingsPlanId: plan.id } })
  await notify(tx, [
    ...notifications.planEnded({ planId: plan.id, customerId: holder.customerId, goal: plan.goal, ajo: true }),
    ...notifications.ajoRoundOut({ groupId, round, agentId: g.agentId, groupName: g.name, roundLabel: label, holderName: `${holder.customer.firstName} ${holder.customer.lastName}`, amount }),
  ])
  const groupCompleted = round === g.size
  if (groupCompleted) await tx.ajoGroup.update({ where: { id: groupId }, data: { status: 'Completed', completedAt: now } })
  return { round, memberId: holder.id, customerId: holder.customerId, amount, savingsPlanId: plan.id, groupCompleted }
}

/**
 * Record one member's payment for a round, then pay the round out if it is now complete. The round must be the one
 * open now (one round at a time). Throws AjoRoundClosedError / AjoAlreadyPaidError; P2002 on a race is the same as paid.
 */
export async function recordContribution(tx: Tx, input: {
  groupId: string; memberId: string; round: number; amount: number; method: 'transfer' | 'cash'; ref: string; agentId?: string; walletAfter?: number
  /** For a bank transfer: who paid. If that place has since been handed to someone else, the payment goes to staff. */
  payerCustomerId?: string
}): Promise<{ payout: PayoutDone | null }> {
  const g = await tx.ajoGroup.findUnique({ where: { id: input.groupId }, select: { name: true, cadence: true, startDate: true, status: true, size: true, agentId: true, payouts: { select: { round: true } } } })
  if (!g || g.status !== 'Running' || openRound(g.size, g.payouts.map(p => p.round)) !== input.round) throw new AjoRoundClosedError()
  const member = await tx.ajoMember.findFirst({ where: { id: input.memberId, groupId: input.groupId, ...(input.payerCustomerId ? { customerId: input.payerCustomerId } : {}) }, select: { customerId: true, customer: { select: { firstName: true, lastName: true } } } })
  if (!member) throw new AjoRoundClosedError()
  if (await tx.ajoContribution.count({ where: { memberId: input.memberId, round: input.round } })) throw new AjoAlreadyPaidError()

  // notify: ajoPaid
  await tx.ajoContribution.create({
    data: { groupId: input.groupId, memberId: input.memberId, round: input.round, amount: input.amount, method: input.method, ref: input.ref, agentId: input.agentId ?? null },
  })
  // In everyone's history, like any other payment.
  await tx.transaction.create({
    data: {
      ref: input.ref, agentId: g.agentId, customerId: member.customerId, type: 'ajo_contribution', amount: input.amount,
      method: input.method === 'cash' ? 'Cash' : 'Bank transfer', status: 'Done', note: `Ajo round ${input.round}`,
      walletAfter: input.walletAfter ?? null,
    },
  })
  await notify(tx, notifications.ajoPaid({
    ref: input.ref, customerId: member.customerId, agentId: g.agentId, groupId: input.groupId, groupName: g.name,
    memberName: `${member.customer.firstName} ${member.customer.lastName}`, roundLabel: roundLabel(g.startDate, g.cadence as AjoCadence, input.round),
    amount: input.amount, byTransfer: input.method === 'transfer',
  }))
  return { payout: await completeRoundIfFunded(tx, input.groupId, input.round) }
}

type Settle = {
  intent: PaymentIntent; reference: string; amountNaira: number; currency?: string
  via: string; manual?: ManualActor; inTx?: (tx: Tx) => Promise<void>
}

/** A bank transfer for an Ajo round arrived (matched by its kobo, or credited by staff). Called from settleIntentPayment. */
export async function settleAjoTransfer(client: PrismaClient, input: Settle): Promise<SettleResult> {
  const { intent, reference } = input
  if (intent.status === INTENT_REVIEW) return { kind: 'review' }
  if (intent.status !== INTENT_PENDING) return { kind: 'already' }
  if (!intent.customerId || !intent.ajoMemberId || !intent.ajoRound) return sendToReview(client, intent, reference, 'an Ajo payment is missing its member or round')
  if (input.currency && input.currency !== intent.currency) return sendToReview(client, intent, reference, `paid in ${input.currency}, expected ${intent.currency}`)

  const member = await client.ajoMember.findFirst({ where: { id: intent.ajoMemberId, customerId: intent.customerId }, select: { id: true, groupId: true, group: { select: { name: true } } } })
  if (!member) return sendToReview(client, intent, reference, `the Ajo member on this payment is gone, amount ₦${input.amountNaira}`)
  const amount = money(input.amountNaira)
  // A contribution is a fixed figure: anything else can't be counted as one, so staff sort it out.
  if (amount !== money(intent.amount)) return sendToReview(client, intent, reference, `Ajo payment of ₦${amount}, expected ₦${intent.amount} (group "${member.group.name}", round ${intent.ajoRound})`)

  let payout: PayoutDone | null = null
  try {
    const won = await client.$transaction(async tx => {
      if (!(await consumePaymentIntent(tx, reference, { customerId: intent.customerId! }))) return false
      if (input.manual) await recordManualCredit(tx, { ref: reference, amount, who: `Ajo group "${member.group.name}", round ${intent.ajoRound}`, manual: input.manual })
      payout = (await recordContribution(tx, {
        groupId: member.groupId, memberId: member.id, round: intent.ajoRound!, amount, method: 'transfer', ref: reference, payerCustomerId: intent.customerId!,
      })).payout
      if (input.inTx) await input.inTx(tx)
      return true
    })
    if (!won) return { kind: 'already' }
  } catch (e) {
    if (e instanceof AjoRoundClosedError || e instanceof AjoAlreadyPaidError || (e as { code?: string })?.code === 'P2002') {
      // The money is real but this round can't take it (already paid, or the round moved on). Staff refund or move it.
      return sendToReview(client, intent, reference, `Ajo payment of ₦${amount} for group "${member.group.name}" round ${intent.ajoRound} arrived after that round was paid or closed`)
    }
    throw e
  }
  logAudit({
    action: 'ajo_contribution', entity: 'AjoGroup', entityId: member.groupId,
    details: `₦${amount} for Ajo group "${member.group.name}" round ${intent.ajoRound} via ${input.via} — ref ${reference}${payout ? ` — round complete, ₦${(payout as PayoutDone).amount} moved to the holder’s payout plan` : ''}`,
    actorType: 'system', actorName: input.via,
  })
  return { kind: 'credited', amount, planId: (payout as PayoutDone | null)?.savingsPlanId ?? '', notBought: 0 }
}
