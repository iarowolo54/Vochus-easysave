// The one way a customer payment reaches a plan's balance. The check and the increment are a single conditional
// update, so a plan closed between reading it and crediting it can't take money nobody could then reach.
import type { Prisma } from '@prisma/client'

/** The statuses a redemption can still collect from. Anything else goes to manual review, so an unexpected one fails safe. */
export const CREDITABLE_PLAN_STATUSES = ['Active', 'Matured']

export class PlanClosedError extends Error {}

/** Add to a plan's balance, or throw PlanClosedError so the caller's transaction rolls back. Run inside that transaction. */
export async function creditPlanBalance(tx: Prisma.TransactionClient, planId: string, amount: number): Promise<void> {
  const res = await tx.savingsPlan.updateMany({
    where: { id: planId, status: { in: CREDITABLE_PLAN_STATUSES } },
    data: { balance: { increment: amount } },
  })
  if (res.count !== 1) throw new PlanClosedError()
}
