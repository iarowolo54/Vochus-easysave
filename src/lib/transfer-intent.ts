// Bank-transfer deposits: a PaymentIntent whose amount carries a unique kobo, so the credit alert that arrives can be
// matched to exactly one customer without a reference.
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { INTENT_PENDING } from '@/lib/payment-intent'
import { money } from '@/lib/wallet-guard'

export const TRANSFER_METHOD = 'transfer'
export const TRANSFER_WINDOW_MS = 30 * 60 * 1000
/** An alert can lag the transfer; one that happened inside the window still counts a little after it closes. */
export const TRANSFER_GRACE_MS = 5 * 60 * 1000

export interface OpenIntent {
  ref: string
  amount: number
  createdAt: Date
  expiresAt: Date | null
}

/** base + the first free kobo (.01 to .99) not in `taken`; null when all 99 are in use. */
export function pickUniqueKobo(base: number, taken: number[]): number | null {
  const used = new Set(taken.map((a) => money(a)))
  for (let k = 1; k <= 99; k++) {
    const candidate = money(base + k / 100)
    if (!used.has(candidate)) return candidate
  }
  return null
}

/** The single open intent this alert pays for, by exact amount and the alert's own transaction time. */
export function matchAlertToIntent(
  alert: { amount: number; at: Date },
  intents: OpenIntent[],
): OpenIntent | 'none' | 'ambiguous' {
  const hits = intents.filter((i) => {
    if (money(i.amount) !== money(alert.amount)) return false
    const closes = (i.expiresAt ?? new Date(i.createdAt.getTime() + TRANSFER_WINDOW_MS)).getTime() + TRANSFER_GRACE_MS
    return alert.at.getTime() >= i.createdAt.getTime() && alert.at.getTime() <= closes
  })
  if (hits.length === 0) return 'none'
  return hits.length === 1 ? hits[0] : 'ambiguous'
}

/** Open means still Pending and not past its grace; these are the amounts a new intent must avoid. */
export function openTransferIntents(now = Date.now()) {
  return prisma.paymentIntent.findMany({
    where: {
      method: TRANSFER_METHOD,
      status: INTENT_PENDING,
      expiresAt: { gt: new Date(now - TRANSFER_GRACE_MS) },
    },
    select: { ref: true, amount: true, createdAt: true, expiresAt: true },
  })
}

/** Creates the intent with a unique amount, or returns null when every kobo for this amount is in use. */
export async function createTransferIntent(input: { customerId: string; planId: string; baseAmount: number }) {
  const ref = `VCHS-TRF-${Date.now()}-${randomBytes(6).toString('base64url').toUpperCase()}`
  return prisma.$transaction(async (tx) => {
    const open = await tx.paymentIntent.findMany({
      where: { method: TRANSFER_METHOD, status: INTENT_PENDING, expiresAt: { gt: new Date(Date.now() - TRANSFER_GRACE_MS) } },
      select: { amount: true },
    })
    const payAmount = pickUniqueKobo(input.baseAmount, open.map((o) => o.amount))
    if (payAmount === null) return null
    const expiresAt = new Date(Date.now() + TRANSFER_WINDOW_MS)
    await tx.paymentIntent.create({
      data: {
        ref, actorType: 'customer', customerId: input.customerId, planId: input.planId,
        amount: payAmount, method: TRANSFER_METHOD, expiresAt,
      },
    })
    return { ref, payAmount, expiresAt }
  })
}
