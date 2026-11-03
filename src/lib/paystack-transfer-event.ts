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

export async function handleTransferEvent(client: PrismaClient, type: string, data: TransferData | undefined): Promise<void> {
  const status = STATUS_BY_EVENT[type]
  if (!status || !data) return
  const transferCode = typeof data.transfer_code === 'string' ? data.transfer_code : ''
  // Released records have no code any more, so they are matched on the reference too.
  const reference = typeof data.reference === 'string' ? data.reference : undefined
  if (!transferCode && !reference) return
  const match = { OR: [...(transferCode ? [{ paystackTransferCode: transferCode }] : []), ...(reference ? [{ ref: reference }] : [])] }

  // Paid after we'd given the money back: the customer can have it twice, and only a person can sort that out.
  if (type === 'transfer.success') {
    const released = await client.earlyRedemption.findMany({
      where: { ...match, status: { in: ['Rejected', 'AgentApproved'] } },
      select: { id: true, ref: true, status: true, netPayout: true },
    })
    for (const r of released) {
      const message = `MANUAL REVIEW: Paystack paid ${r.ref} after it was marked ${r.status}, so the money may have gone out twice. Paystack said: transfer.success, code ${transferCode || 'none'}, reference ${reference ?? 'none'}, amount ${data.amount ?? 'none'} ${data.currency ?? ''}.`
      await logAudit({ action: 'early_redemption_paid_after_release', entity: 'EarlyRedemption', entityId: r.id, details: message, actorType: 'system', actorName: 'Paystack Webhook' })
      await notifySuperAdminsPayoutReview(client, { ref: r.ref, message })
    }
  }

  await client.earlyRedemption.updateMany({ where: match, data: { bankTransferStatus: status } })
  logAudit({
    action: 'paystack_transfer_status_update',
    entity: 'EarlyRedemption',
    details: `Paystack webhook: transfer ${transferCode || reference} → ${status}`,
    actorType: 'system',
    actorName: 'Paystack Webhook',
  })
}
