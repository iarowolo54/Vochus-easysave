// The one way a customer payment reaches a plan's balance. The check and the increment are a single conditional
// update, so a plan closed between reading it and crediting it can't take money nobody could then reach.
import type { Prisma } from '@prisma/client'

/** A plan takes deposits only while it is Active and before its maturity date. Anything else goes to manual review, so an unexpected state fails safe. */
export const DEPOSIT_PLAN_STATUS = 'Active'

export const PLAN_ENDED = 'This plan has matured, so no more savings can be added to it. Nothing was recorded and your wallet wasn’t charged.'

/** True once the plan's maturity date has passed. The plan's status isn't flipped automatically, so the date is the source of truth. */
export const planHasEnded = (plan: { maturityDate: Date }, now: Date = new Date()) => plan.maturityDate.getTime() <= now.getTime()

/**
 * Can money be saved into this plan right now? Active and before its end date. Screens use this to decide which plans
 * to offer; the server uses the same rule (and creditPlanBalance re-checks it inside the write). Dates may be JSON strings.
 */
export function isOpenForSaving(plan: { status: string; maturityDate: Date | string | null }, now: Date = new Date()): boolean {
  if (plan.status !== DEPOSIT_PLAN_STATUS || !plan.maturityDate) return false
  const end = new Date(plan.maturityDate)
  return !Number.isNaN(end.getTime()) && end.getTime() > now.getTime()
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/**
 * A dated (cash) deposit must be for a day the plan runs: from its start day up to the day before its end date.
 * Without this an agent could record days past the end while the plan was still open.
 */
export function depositDayInPlan(plan: { startDate: Date; maturityDate: Date }, day: Date): boolean {
  if (Number.isNaN(day.getTime())) return false
  const d = dayStart(day).getTime()
  return d >= dayStart(plan.startDate).getTime() && d < dayStart(plan.maturityDate).getTime()
}

const shortDay = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function outsidePlanMessage(plan: { startDate: Date; maturityDate: Date }): string {
  const end = dayStart(plan.maturityDate)
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)
  return `That day isn’t part of this plan. It runs from ${shortDay(plan.startDate)} to ${shortDay(last)}. Nothing was recorded and your wallet wasn’t charged.`
}

export class PlanClosedError extends Error {}

/** Add to a plan's balance, or throw PlanClosedError so the caller's transaction rolls back. Run inside that transaction. */
export async function creditPlanBalance(tx: Prisma.TransactionClient, planId: string, amount: number): Promise<void> {
  const res = await tx.savingsPlan.updateMany({
    where: { id: planId, status: DEPOSIT_PLAN_STATUS, maturityDate: { gt: new Date() } },
    data: { balance: { increment: amount } },
  })
  if (res.count !== 1) throw new PlanClosedError()
}
