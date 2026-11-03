// The one lookup behind a payout receipt's status, shared by the receipt page and send-receipt.
import { prisma } from '@/lib/prisma'
import { payoutOutcome, payoutRef, receiptStatus, type PayoutOutcome } from '@/lib/receipt-message'

/** Null for rows that aren't payouts, with no query. */
export async function loadPayoutOutcome(t: { type: string; ref: string; method: string | null }): Promise<PayoutOutcome | null> {
  const ref = payoutRef(t)
  if (!ref) return null
  const record = await prisma.earlyRedemption.findUnique({ where: { ref }, select: { payoutMethod: true, bankTransferStatus: true } })
  return payoutOutcome(t, record)
}

/**
 * The status a list should show for each row. A payout row is written Done once Paystack accepts the transfer,
 * so it reads Processing until the transfer is confirmed, and Failed or Reversed if it wasn't paid. One query
 * for the whole list; every other row keeps its own status.
 */
export async function listedStatuses(rows: { id: string; type: string; ref: string; method: string | null; status: string }[]): Promise<Map<string, string>> {
  const refs = new Map<string, string[]>()
  for (const row of rows) {
    const ref = payoutRef(row)
    if (ref) refs.set(ref, [...(refs.get(ref) ?? []), row.id])
  }
  const records = refs.size
    ? await prisma.earlyRedemption.findMany({ where: { ref: { in: [...refs.keys()] } }, select: { ref: true, payoutMethod: true, bankTransferStatus: true } })
    : []
  const byRef = new Map(records.map(r => [r.ref, r]))
  const out = new Map<string, string>()
  for (const row of rows) {
    const ref = payoutRef(row)
    if (!ref) { out.set(row.id, row.status); continue }
    out.set(row.id, receiptStatus({ status: row.status, payout: payoutOutcome(row, byRef.get(ref) ?? null) }))
  }
  return out
}
