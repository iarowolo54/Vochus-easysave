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
