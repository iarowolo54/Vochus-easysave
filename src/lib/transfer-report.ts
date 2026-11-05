// A person who has sent a bank transfer can tell us they left the extra kobo out. We can't match that money on our own, so
// staff are told. It is kept in the audit log (append-only, no schema change) and read back by the admin transfers page.
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { INTENT_PENDING } from '@/lib/payment-intent'
import { TRANSFER_METHOD, type TransferActor } from '@/lib/transfer-intent'

export const KOBO_LEFT_OUT = 'transfer_kobo_left_out'

/**
 * Records that the owner of this open request says they sent a rounded amount. Only the owner's own Pending request counts,
 * and a second report for the same request is ignored. Returns false when there is nothing to report on.
 */
export async function reportKoboLeftOut(ref: string, actor: TransferActor, who: { type: 'customer' | 'agent'; id: string; name?: string }): Promise<boolean> {
  const mine = 'customerId' in actor ? { customerId: actor.customerId } : { agentId: actor.agentId }
  const intent = await prisma.paymentIntent.findFirst({ where: { ref, method: TRANSFER_METHOD, status: INTENT_PENDING, ...mine }, select: { id: true, amount: true } })
  if (!intent) return false
  const already = await prisma.auditLog.findFirst({ where: { action: KOBO_LEFT_OUT, entityId: intent.id }, select: { id: true } })
  if (!already) {
    await logAudit({
      action: KOBO_LEFT_OUT, entity: 'PaymentIntent', entityId: intent.id,
      details: `${who.type === 'agent' ? 'Agent' : 'Customer'} says they sent request ${ref} without the extra kobo (shown amount ${intent.amount.toFixed(2)})`,
      actorType: who.type, actorId: who.id, actorName: who.name,
    })
  }
  return true
}
