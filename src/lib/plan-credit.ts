// The one way a customer payment reaches a plan's balance. The check and the increment are a single conditional
// update, so a plan redeemed between reading it and crediting it can't take money nobody could then reach.
import type { Prisma } from '@prisma/client'

export class PlanClosedError extends Error {}

/** Add to a plan's balance, or throw PlanClosedError so the caller's transaction rolls back. Run inside that transaction. */
export async function creditPlanBalance(tx: Prisma.TransactionClient, planId: string, amount: number): Promise<void> {
  const res = await tx.savingsPlan.updateMany({
    where: { id: planId, status: { not: 'Redeemed' } },
    data: { balance: { increment: amount } },
  })
  if (res.count !== 1) throw new PlanClosedError()
}
