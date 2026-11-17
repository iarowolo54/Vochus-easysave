// A person who has sent a bank transfer can tell us they left the extra kobo out. We can't match that money on our own, so
// staff are told. It is kept in the audit log (append-only, no schema change) and read back by the admin transfers page.
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { INTENT_PENDING } from '@/lib/payment-intent'
import { TRANSFER_METHOD, type TransferActor } from '@/lib/transfer-intent'

export const KOBO_LEFT_OUT = 'transfer_kobo_left_out'
/** Staff looked into a kobo report and dealt with it, so it stops asking for attention. */
export const KOBO_CHECKED = 'transfer_kobo_checked'

export type KoboCheck = { by: string; at: string; note: string }

/** Reads a check entry's note back out of its audit details (written by markKoboChecked). */
export const koboCheckFrom = (e: { actorName: string | null; createdAt: Date; details: string | null }): KoboCheck =>
  ({ by: e.actorName ?? 'Staff', at: e.createdAt.toISOString(), note: (e.details ?? '').replace(/^.*?Note: /, '') })

/**
 * Staff mark a kobo report as checked (for example the money never came, or it was sorted out another way). Only an open
 * request with a report counts, and only once. The report and the check both stay in the audit log.
 */
export async function markKoboChecked(intentId: string, admin: { id?: string; name: string }, note: string):
  Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const intent = await prisma.paymentIntent.findFirst({ where: { id: intentId, method: TRANSFER_METHOD, status: INTENT_PENDING }, select: { id: true, ref: true } })
  if (!intent) return { ok: false, status: 404, error: 'That request is no longer open. Refresh the page.' }
  const [reported, checked] = await Promise.all([
    prisma.auditLog.findFirst({ where: { action: KOBO_LEFT_OUT, entityId: intent.id }, select: { id: true } }),
    prisma.auditLog.findFirst({ where: { action: KOBO_CHECKED, entityId: intent.id }, select: { id: true } }),
  ])
  if (!reported) return { ok: false, status: 404, error: 'Nobody reported this request. Refresh the page.' }
  if (checked) return { ok: false, status: 409, error: 'Someone has already marked this as checked. Refresh the page.' }
  await logAudit({
    action: KOBO_CHECKED, entity: 'PaymentIntent', entityId: intent.id,
    details: `Marked the kobo report on request ${intent.ref} as checked. Note: ${note}`,
    actorType: 'admin', actorId: admin.id, actorName: admin.name,
  })
  return { ok: true }
}

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
