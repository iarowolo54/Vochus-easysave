// How a bank transfer shows on the staff screen. Pure: no database access here.
import { INTENT_DONE, INTENT_PENDING, INTENT_REVIEW } from '@/lib/payment-intent'
import { TRANSFER_GRACE_MS } from '@/lib/transfer-intent'

export type TransferStatus = 'paid' | 'waiting' | 'not-paid' | 'needs-review' | 'by-hand'

export const STATUS_LABEL: Record<TransferStatus, string> = {
  paid: 'Paid',
  waiting: 'Waiting',
  'not-paid': 'Not paid',
  'needs-review': 'Needs review',
  'by-hand': 'Credited by hand',
}

export function intentStatus(
  i: { status: string; expiresAt: Date | null; manualBy: string | null },
  now: number = Date.now(),
): TransferStatus {
  if (i.status === INTENT_DONE) return i.manualBy ? 'by-hand' : 'paid'
  if (i.status === INTENT_REVIEW) return 'needs-review'
  if (i.status === INTENT_PENDING) {
    return (i.expiresAt?.getTime() ?? 0) + TRANSFER_GRACE_MS > now ? 'waiting' : 'not-paid'
  }
  return 'not-paid'
}

/** A held alert: still unmatched needs review; resolved means staff credited it; dismissed is not shown as a problem. */
export function alertStatus(a: { status: string }): TransferStatus | 'dismissed' {
  if (a.status === 'Unmatched') return 'needs-review'
  if (a.status === 'Resolved') return 'by-hand'
  if (a.status === 'Dismissed') return 'dismissed'
  return 'paid'
}
