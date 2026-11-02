// The one lookup behind a payout receipt's status, shared by the receipt page and send-receipt.
import { prisma } from '@/lib/prisma'
import { payoutOutcome, payoutRef, type PayoutOutcome } from '@/lib/receipt-message'

/** Null for rows that aren't payouts, with no query. */
export async function loadPayoutOutcome(t: { type: string; ref: string; method: string | null }): Promise<PayoutOutcome | null> {
  const ref = payoutRef(t)
  if (!ref) return null
  const record = await prisma.earlyRedemption.findUnique({ where: { ref }, select: { payoutMethod: true, bankTransferStatus: true } })
  return payoutOutcome(t, record)
}
