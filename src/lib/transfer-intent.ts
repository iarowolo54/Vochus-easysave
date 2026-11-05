// Bank-transfer deposits: a PaymentIntent whose amount carries a unique kobo, so the credit alert that arrives can be
// matched to exactly one customer without a reference.
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { INTENT_PENDING, INTENT_SUPERSEDED, parseCoversKeys } from '@/lib/payment-intent'
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

/**
 * An open intent the person can simply keep using: same plan, same days, the same base amount (the amount shown is that
 * base plus the kobo we added, never more than 99 kobo), and not yet expired.
 */
export function canReuse(
  intent: { amount: number; planId: string | null; expiresAt: Date | null; coversKeys?: string | null },
  planId: string | null,
  baseAmount: number,
  covers: string[] = [],
  now: number = Date.now(),
): boolean {
  const extra = money(intent.amount - baseAmount)
  const sameDays = parseCoversKeys(intent.coversKeys ?? null).sort().join(',') === [...covers].sort().join(',')
  return intent.planId === planId && sameDays && extra > 0 && extra <= 0.99 && (intent.expiresAt?.getTime() ?? 0) > now
}

/** Open means still Pending and not past its grace; these are the amounts a new intent must avoid. */
export function openTransferIntents(now = Date.now()) {
  return prisma.paymentIntent.findMany({
    where: {
      method: TRANSFER_METHOD,
      status: INTENT_PENDING,
      manualBy: null,
      expiresAt: { gt: new Date(now - TRANSFER_GRACE_MS) },
    },
    select: { ref: true, amount: true, createdAt: true, expiresAt: true },
  })
}

export type TransferActor = { customerId: string } | { agentId: string }

/**
 * Creates the intent with a unique amount, or returns null when every kobo for this amount is in use. An actor (a
 * customer or an agent) has one open transfer at a time: asking again for the same plan and amount returns it, and
 * anything else closes the old one (it still counts for the grace period, in case they pay it). So one account can't tie
 * up the kobo pool. `planId` is the savings plan for a customer and null for an agent's wallet.
 */
export async function createTransferIntent(input: { actor: TransferActor; planId: string | null; baseAmount: number; coversKeys?: string[] }) {
  const ref = `VCHS-TRF-${Date.now()}-${randomBytes(6).toString('base64url').toUpperCase()}`
  const mineWhere = 'customerId' in input.actor ? { customerId: input.actor.customerId } : { agentId: input.actor.agentId }
  return prisma.$transaction(async (tx) => {
    const now = Date.now()
    const live = { method: TRANSFER_METHOD, status: INTENT_PENDING, expiresAt: { gt: new Date(now - TRANSFER_GRACE_MS) } }

    const mine = await tx.paymentIntent.findMany({ where: { ...live, ...mineWhere } })
    const again = mine.find((i) => canReuse(i, input.planId, input.baseAmount, input.coversKeys ?? [], now))
    if (again && again.expiresAt) return { ref: again.ref, payAmount: again.amount, expiresAt: again.expiresAt }
    for (const old of mine) {
      if (old.expiresAt && old.expiresAt.getTime() > now) {
        await tx.paymentIntent.update({ where: { id: old.id }, data: { expiresAt: new Date(now) } })
      }
    }

    // A closed (superseded) request still counts: its person may yet be looking at the amount, so nobody else gets it.
    const open = await tx.paymentIntent.findMany({ where: { ...live, status: { in: [INTENT_PENDING, INTENT_SUPERSEDED] } }, select: { amount: true } })
    const payAmount = pickUniqueKobo(input.baseAmount, open.map((o) => o.amount))
    if (payAmount === null) return null
    const expiresAt = new Date(now + TRANSFER_WINDOW_MS)
    await tx.paymentIntent.create({
      data: {
        ref, actorType: 'customerId' in input.actor ? 'customer' : 'agent', planId: input.planId,
        ...mineWhere, amount: payAmount, method: TRANSFER_METHOD, expiresAt,
        coversKeys: input.coversKeys && input.coversKeys.length > 0 ? JSON.stringify(input.coversKeys) : null,
      },
    })
    return { ref, payAmount, expiresAt }
  })
}
