// Server-side payment-intent binding for Paystack flows (findings #2/#3).
//
// At `init` we persist a Pending intent tying a reference to the actor, plan and
// amount it was created for. At `verify` we require that intent (for this actor),
// check the Paystack amount against it, and atomically consume it. This stops an
// attacker from claiming an arbitrary successful reference or crediting a
// mismatched amount — the verify can only ever settle a payment this server
// initiated for this actor.
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'

export const INTENT_PENDING = 'Pending'
export const INTENT_DONE = 'Done'
/** Money arrived that can't be credited as it stands (wrong currency, closed plan). Staff resolve it from the audit log. */
export const INTENT_REVIEW = 'Review'
/** Audit action for money that arrived but wasn't credited. Staff work from these rows. */
export const REVIEW_ACTION = 'payment_needs_manual_review'

export interface IntentInput {
  ref: string
  actorType: 'agent' | 'customer'
  agentId?: string | null
  customerId?: string | null
  planId?: string | null
  amount: number
  /** Day-keys (local YYYY-MM-DD) this payment catches up; stored as a JSON array. */
  coversKeys?: string[]
}

export function createPaymentIntent(data: IntentInput) {
  return prisma.paymentIntent.create({
    data: {
      ref: data.ref,
      actorType: data.actorType,
      agentId: data.agentId ?? null,
      customerId: data.customerId ?? null,
      planId: data.planId ?? null,
      amount: data.amount,
      coversKeys: data.coversKeys ? JSON.stringify(data.coversKeys) : null,
    },
  })
}

/** The day-keys stored on an intent. Malformed or absent means none. */
export function parseCoversKeys(stored: string | null): string[] {
  if (!stored) return []
  try {
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/** The still-pending intent for this ref, but only if it belongs to the actor. */
export function findOwnedPendingIntent(
  ref: string,
  owner: { agentId?: string; customerId?: string },
) {
  return prisma.paymentIntent.findFirst({
    where: { ref, status: INTENT_PENDING, ...owner },
  })
}

/** Atomically consume (Pending -> Done) the intent for this ref + owner. Returns
 *  true iff this call won; a losing concurrent call or a non-owner gets false and
 *  must not credit. Run inside the crediting transaction. */
export async function consumePaymentIntent(
  client: Prisma.TransactionClient | typeof prisma,
  ref: string,
  owner: { agentId?: string; customerId?: string },
  now: number = Date.now(),
): Promise<boolean> {
  const res = await client.paymentIntent.updateMany({
    where: { ref, status: INTENT_PENDING, ...owner },
    data: { status: INTENT_DONE, consumedAt: new Date(now) },
  })
  return res.count === 1
}

/** Who credited a payment by hand and why. Recorded in the SAME transaction as the credit, so one cannot exist without the other. */
export interface ManualActor { adminId?: string; adminName: string; note: string }

export async function recordManualCredit(
  tx: Prisma.TransactionClient,
  input: { ref: string; amount: number; who: string; manual: ManualActor },
): Promise<void> {
  await tx.paymentIntent.update({ where: { ref: input.ref }, data: { manualBy: input.manual.adminName, manualNote: input.manual.note } })
  await tx.auditLog.create({
    data: {
      action: 'bank_transfer_credited_by_hand', entity: 'Transfer', entityId: input.ref,
      details: `${input.manual.adminName} credited ₦${input.amount} by hand to ${input.who} — ref ${input.ref} — note: ${input.manual.note}`,
      actorType: 'admin', actorId: input.manual.adminId, actorName: input.manual.adminName,
    },
  })
}
