// Paystack's payout outcome events. Both webhook routes call this, so a payout's status is recorded the same
// way whichever URL Paystack is pointed at. Writing the same status twice is harmless, so redelivery is safe.
import type { PrismaClient } from '@prisma/client'
import { logAudit } from '@/lib/audit'
import { notifySuperAdminsPayoutReview } from '@/lib/redemption-notify'

export const TRANSFER_EVENTS = ['transfer.success', 'transfer.failed', 'transfer.reversed'] as const

const STATUS_BY_EVENT: Record<string, string> = {
  'transfer.success': 'success',
  'transfer.failed': 'failed',
  'transfer.reversed': 'reversed',
}

export const isTransferEvent = (type: unknown): type is (typeof TRANSFER_EVENTS)[number] =>
  typeof type === 'string' && type in STATUS_BY_EVENT

type TransferData = {
  transfer_code?: unknown
  reference?: unknown
  amount?: unknown
  currency?: unknown
}

/**
 * Events can arrive late and out of order, and an admin can record a payout as paid by hand ('manual'). So an event
 * only moves a payout forward: success may later be reversed, but nothing replaces failed, reversed, manual or one of
 * the final not-paid states. Paystack reporting success for a payout we already hold as not paid is the dangerous
 * case (the customer may have been refunded and paid), so it goes to staff.
 */
const FINAL_NOT_PAID = ['failed', 'reversed', 'abandoned', 'blocked', 'rejected']
const CANNOT_REPLACE: Record<string, string[]> = {
  success: [...FINAL_NOT_PAID, 'manual'],
  failed: ['success', 'reversed', 'abandoned', 'blocked', 'rejected', 'manual'],
  reversed: ['failed', 'abandoned', 'blocked', 'rejected', 'manual'],
}

export async function handleTransferEvent(client: PrismaClient, type: string, data: TransferData | undefined): Promise<void> {
  const status = STATUS_BY_EVENT[type]
  if (!status || !data) return
  const transferCode = typeof data.transfer_code === 'string' ? data.transfer_code : ''
  // Released records have no code any more, so they are matched on the reference too.
  const reference = typeof data.reference === 'string' ? data.reference : undefined
  if (!transferCode && !reference) return
  const match = { OR: [...(transferCode ? [{ paystackTransferCode: transferCode }] : []), ...(reference ? [{ ref: reference }] : [])] }

  const records = await client.earlyRedemption.findMany({
    where: match,
    select: { id: true, ref: true, status: true, bankTransferStatus: true },
  })
  const heldAs = (r: { bankTransferStatus: string | null }) => r.bankTransferStatus ?? ''
  const refused = records.filter(r => CANNOT_REPLACE[status].includes(heldAs(r)))

  // Paid after we'd given the money back: the customer can have it twice, and only a person can sort that out.
  if (type === 'transfer.success') {
    for (const r of records.filter(x => x.status === 'Rejected' || x.status === 'AgentApproved')) {
      const message = `MANUAL REVIEW: Paystack paid ${r.ref} after it was marked ${r.status}, so the money may have gone out twice. Paystack said: transfer.success, code ${transferCode || 'none'}, reference ${reference ?? 'none'}, amount ${data.amount ?? 'none'} ${data.currency ?? ''}.`
      await logAudit({ action: 'early_redemption_paid_after_release', entity: 'EarlyRedemption', entityId: r.id, details: message, actorType: 'system', actorName: 'Paystack Webhook' })
      await notifySuperAdminsPayoutReview(client, { ref: r.ref, message })
    }
  }

  for (const r of refused) {
    const message = `MANUAL REVIEW: Paystack said ${status} for ${r.ref}, but it is recorded as ${heldAs(r)}, so the record was left as it is. Code ${transferCode || 'none'}, reference ${reference ?? 'none'}.`
    await logAudit({ action: 'paystack_transfer_status_conflict', entity: 'EarlyRedemption', entityId: r.id, details: message, actorType: 'system', actorName: 'Paystack Webhook' })
    // Paid by Paystack but held as not paid or paid by hand: the one outcome that can mean the money went out twice.
    if (status === 'success') await notifySuperAdminsPayoutReview(client, { ref: r.ref, message })
  }

  // Conditional on the stored status, so two events racing can't undo each other. A null status counts as open.
  const updated = await client.earlyRedemption.updateMany({
    where: { AND: [match, { OR: [{ bankTransferStatus: null }, { bankTransferStatus: { notIn: CANNOT_REPLACE[status] } }] }] },
    data: { bankTransferStatus: status },
  })
  if (updated.count > 0) {
    logAudit({
      action: 'paystack_transfer_status_update',
      entity: 'EarlyRedemption',
      details: `Paystack webhook: transfer ${transferCode || reference} → ${status}`,
      actorType: 'system',
      actorName: 'Paystack Webhook',
    })
  }
}
