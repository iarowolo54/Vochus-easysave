// Crediting a bank transfer by hand. Staff do this when a payment arrived but the alert never matched, or a customer
// or agent paid and no alert came. It reuses the automatic settle paths, so fees, covered days and the transaction
// record are exactly what an automatic credit would give. Every step is a conditional update, so two staff acting on
// the same row credit it once.
import { randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { logAudit } from '@/lib/audit'
import { INTENT_PENDING, INTENT_SUPERSEDED, type ManualActor } from '@/lib/payment-intent'
import { settleIntentPayment } from '@/lib/customer-settle'
import { settleAgentTransfer } from '@/lib/agent-settle'
import { TRANSFER_METHOD } from '@/lib/transfer-intent'
import { HAND_WINDOW_MS, nearAmount } from '@/lib/transfer-figure'
import { money } from '@/lib/wallet-guard'

export type Admin = { id?: string; name: string }
export type ManualResult = { ok: true; amount: number } | { ok: false; status: 404 | 409 | 422; error: string }

export const NOTE_MIN = 3
export const NOTE_MAX = 300

export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const note = raw.trim()
  return note.length >= NOTE_MIN && note.length <= NOTE_MAX ? note : null
}

const CLOSED = 'This can’t be credited as it stands: the plan is closed or the account is missing. Nothing was credited.'
const TAKEN = 'This was already dealt with by someone else.'

function audit(admin: Admin, action: string, entityId: string, details: string) {
  return logAudit({ action, entity: 'Transfer', entityId, details, actorType: 'admin', actorId: admin.id, actorName: admin.name })
}

type Intent = Awaited<ReturnType<PrismaClient['paymentIntent']['findUniqueOrThrow']>>
type InTx = NonNullable<Parameters<typeof settleAgentTransfer>[1]['inTx']>

/** Settles through the automatic paths. Who did it and why is written in the same transaction as the credit. */
function settle(client: PrismaClient, intent: Intent, admin: Admin, note: string, inTx?: InTx) {
  const manual: ManualActor = { adminId: admin.id, adminName: admin.name, note }
  if (intent.actorType === 'agent') {
    return settleAgentTransfer(client, { intent, reference: intent.ref, amountNaira: intent.amount, via: 'Staff by hand', manual, inTx })
  }
  return settleIntentPayment(client, {
    intent, reference: intent.ref, amountNaira: intent.amount, currency: intent.currency, channel: 'bank_transfer', via: 'Staff by hand', manual, inTx,
  })
}

const HELD_SAME_AMOUNT =
  'Money for about this amount is already held on this screen (within ₦1 of it). If it is the same payment, credit the held money to this person instead, or dismiss it first, so it isn’t credited twice.'
const LOOKALIKE =
  'This is within ₦1 of a payment staff credited by hand within 3 days of it. It may be the same money. Tick the box to confirm you have checked it is not, then try again.'

/**
 * A payment staff credited by hand within 3 days either side of `around`, for the same figure (within ₦1). Anchored to
 * the payment being looked at, so an old alert is compared with the hand credits from its own time, not today's.
 */
export function findRecentHandCredit(client: PrismaClient, amount: number, around: Date = new Date()) {
  return client.paymentIntent.findFirst({
    where: {
      manualBy: { not: null }, status: 'Done',
      consumedAt: { gte: new Date(around.getTime() - HAND_WINDOW_MS), lte: new Date(around.getTime() + HAND_WINDOW_MS) },
      amount: nearAmount(amount),
    },
    select: { ref: true },
  })
}

/** A started transfer the person says they paid. Credited at the amount they were shown. */
export async function creditRequestByHand(
  client: PrismaClient,
  input: { ref: string; admin: Admin; note: string; ackLookalike?: boolean },
): Promise<ManualResult> {
  const intent = await client.paymentIntent.findFirst({ where: { ref: input.ref, method: TRANSFER_METHOD } })
  if (!intent) return { ok: false, status: 404, error: 'Transfer not found.' }
  if (intent.status !== INTENT_PENDING) return { ok: false, status: 409, error: TAKEN }

  // The bank may already have told us about this money. Crediting both would pay it twice.
  const held = await client.bankAlert.findFirst({
    where: { status: 'Unmatched', amount: nearAmount(intent.amount), alertAt: { gte: intent.createdAt } },
    select: { id: true },
  })
  if (held) return { ok: false, status: 409, error: HELD_SAME_AMOUNT }

  // Something for the same figure was already credited by hand (a request, or held money given to someone).
  if (!input.ackLookalike && await findRecentHandCredit(client, intent.amount)) {
    return { ok: false, status: 409, error: LOOKALIKE }
  }

  const result = await settle(client, intent, input.admin, input.note)
  if (result.kind === 'already') return { ok: false, status: 409, error: TAKEN }
  if (result.kind === 'review') return { ok: false, status: 422, error: CLOSED }
  return { ok: true, amount: intent.amount }
}

export type AlertTarget = { kind: 'customer'; customerId: string; planId: string } | { kind: 'agent'; agentId: string }

/** Money that arrived and was held. Credited to the customer's plan or the agent's wallet staff choose. */
export async function creditAlertByHand(
  client: PrismaClient,
  input: { alertId: string; target: AlertTarget; admin: Admin; note: string; ackLookalike?: boolean },
): Promise<ManualResult> {
  const alert = await client.bankAlert.findUnique({ where: { id: input.alertId } })
  if (!alert) return { ok: false, status: 404, error: 'Held payment not found.' }

  // The target must exist, and a plan must belong to the customer, before anything is claimed.
  if (input.target.kind === 'customer') {
    const plan = await client.savingsPlan.findFirst({ where: { id: input.target.planId, customerId: input.target.customerId }, select: { id: true } })
    if (!plan) return { ok: false, status: 404, error: 'That customer or plan wasn’t found.' }
  } else {
    const agent = await client.agent.findUnique({ where: { id: input.target.agentId }, select: { id: true } })
    if (!agent) return { ok: false, status: 404, error: 'That agent wasn’t found.' }
  }

  // Money that looks like a payment already credited by hand needs the staff member to say they checked.
  if (!input.ackLookalike && alert.status === 'Unmatched' && await findRecentHandCredit(client, alert.amount, alert.alertAt)) {
    return { ok: false, status: 409, error: LOOKALIKE }
  }

  const amount = money(alert.amount)
  const ref = `VCHS-MAN-${Date.now()}-${randomBytes(5).toString('base64url').toUpperCase()}`
  // Never open to the automatic matcher: it is dated an hour ago and marked as staff-made. It is consumed in one step below.
  const intent = await client.paymentIntent.create({
    data: {
      ref, method: TRANSFER_METHOD, amount, expiresAt: new Date(Date.now() - 3_600_000),
      manualBy: input.admin.name, manualNote: input.note,
      ...(input.target.kind === 'customer'
        ? { actorType: 'customer', customerId: input.target.customerId, planId: input.target.planId }
        : { actorType: 'agent', agentId: input.target.agentId }),
    },
  })

  // The claim on the alert is part of the credit's own transaction: both happen, or neither does. Only one caller can
  // flip Unmatched to Resolved, so two staff acting at once credit once.
  const claim: InTx = async (tx) => {
    const claimed = await tx.bankAlert.updateMany({
      where: { id: alert.id, status: 'Unmatched' },
      data: { status: 'Resolved', resolvedAt: new Date(), resolvedBy: input.admin.name, resolvedNote: input.note, intentRef: ref },
    })
    if (claimed.count !== 1) throw new Error('ALREADY_PROCESSED')
    // This money is now the person's credit. Their still-open requests for the same figure are the same payment, so
    // close them in the same transaction; otherwise one could be credited again by hand.
    await tx.paymentIntent.updateMany({
      where: {
        method: TRANSFER_METHOD, status: INTENT_PENDING, manualBy: null, amount: nearAmount(alert.amount),
        ...(input.target.kind === 'customer' ? { customerId: input.target.customerId } : { agentId: input.target.agentId }),
      },
      data: { status: INTENT_SUPERSEDED },
    })
  }

  let result
  try {
    result = await settle(client, intent, input.admin, input.note, claim)
  } catch (e) {
    await client.paymentIntent.deleteMany({ where: { id: intent.id, status: INTENT_PENDING } })
    throw e
  }
  if (result.kind !== 'credited') {
    await client.paymentIntent.deleteMany({ where: { id: intent.id, status: { not: 'Done' } } })
    return result.kind === 'already' ? { ok: false, status: 409, error: TAKEN } : { ok: false, status: 422, error: CLOSED }
  }
  return { ok: true, amount }
}

/** Not a customer or agent payment, or already credited by hand. Takes it off the review list without crediting. */
export async function dismissAlert(client: PrismaClient, input: { alertId: string; admin: Admin; note: string }): Promise<ManualResult> {
  const alert = await client.bankAlert.findUnique({ where: { id: input.alertId } })
  if (!alert) return { ok: false, status: 404, error: 'Held payment not found.' }
  const res = await client.bankAlert.updateMany({
    where: { id: alert.id, status: 'Unmatched' },
    data: { status: 'Dismissed', resolvedAt: new Date(), resolvedBy: input.admin.name, resolvedNote: input.note },
  })
  if (res.count !== 1) return { ok: false, status: 409, error: TAKEN }
  await audit(input.admin, 'bank_alert_dismissed', alert.id,
    `${input.admin.name} dismissed a held ₦${alert.amount} (bank txn ${alert.txnId}) — note: ${input.note}`)
  return { ok: true, amount: alert.amount }
}
