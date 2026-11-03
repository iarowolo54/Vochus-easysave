// The one way a customer payment reaches a plan's balance. The check and the increment are a single conditional
// update, so a plan closed between reading it and crediting it can't take money nobody could then reach.
import type { Prisma } from '@prisma/client'

/** A plan takes deposits only while it is Active and before its maturity date. Anything else goes to manual review, so an unexpected state fails safe. */
export const DEPOSIT_PLAN_STATUS = 'Active'

export const PLAN_ENDED = 'This plan has matured, so no more savings can be added to it. Nothing was recorded and your wallet wasn’t charged.'

/** True once the plan's maturity date has passed. The plan's status isn't flipped automatically, so the date is the source of truth. */
export const planHasEnded = (plan: { maturityDate: Date }, now: Date = new Date()) => plan.maturityDate.getTime() <= now.getTime()

export class PlanClosedError extends Error {}

/** Add to a plan's balance, or throw PlanClosedError so the caller's transaction rolls back. Run inside that transaction. */
export async function creditPlanBalance(tx: Prisma.TransactionClient, planId: string, amount: number): Promise<void> {
  const res = await tx.savingsPlan.updateMany({
    where: { id: planId, status: DEPOSIT_PLAN_STATUS, maturityDate: { gt: new Date() } },
    data: { balance: { increment: amount } },
  })
  if (res.count !== 1) throw new PlanClosedError()
}
