// A redemption's payout was worked out from the balance at request time. Paying it after the balance
// has changed, then zeroing the plan, wipes whatever arrived in between. So every path that closes a
// plan for a redemption goes through here, and a changed balance blocks it (no recalculation).
import type { Prisma, PrismaClient } from '@prisma/client'
import { IN_FLIGHT_REDEMPTION_STATUSES } from './redemption-statuses'

type Client = Pick<PrismaClient, 'savingsPlan' | 'earlyRedemption'> | Prisma.TransactionClient

export const SAVING_BLOCKED = 'This customer has asked to collect from this plan, so new savings can’t be recorded yet. Wait for the office to decide, or ask an admin to reject the request.'
export const PLAN_CLOSED = 'This plan has been closed, so nothing was recorded and your wallet wasn’t charged.'
export const BALANCE_CHANGED = 'This customer’s balance has changed since they asked to collect. Reject this request and ask them to request again.'
export const BALANCE_CHANGED_AWAITING_OTP = 'This customer’s balance has changed while this payout was waiting for its code. Nothing has been paid. Don’t enter the code; this request needs a manual fix.'

// Some requests store money(plan.balance), which can differ from the stored float by half a kobo.
// The smallest real deposit is a whole kobo, so this can't hide one.
const TOLERANCE = 0.006
const near = (amount: number) => ({ gte: amount - TOLERANCE, lte: amount + TOLERANCE })

export const balanceUnchanged = (current: number, requested: number) => Math.abs(current - requested) <= TOLERANCE

/**
 * Close the plan only if its balance is still what was requested. Returns null on success, otherwise
 * the reason to show. Run inside the crediting transaction, and before any transfer starts.
 */
export async function claimPlanForPayout(client: Client, planId: string, requestedBalance: number): Promise<string | null> {
  const claimed = await client.savingsPlan.updateMany({
    where: { id: planId, status: { not: 'Redeemed' }, balance: { gt: 0, ...near(requestedBalance) } },
    data: { status: 'Redeemed', balance: 0 },
  })
  if (claimed.count === 1) return null
  const plan = await client.savingsPlan.findUnique({ where: { id: planId }, select: { status: true, balance: true } })
  return plan && plan.status !== 'Redeemed' && plan.balance > 0 ? BALANCE_CHANGED : 'This plan has already been redeemed'
}

/**
 * An OTP payout's plan was already closed and zeroed by the pre-claim, so a Redeemed plan must be at 0:
 * anything on it is money that landed since, even if it happens to equal the requested amount. The
 * requested balance only applies to an open plan, on records that reached AwaitingOTP without a pre-claim.
 */
export const readyToFinalize = (plan: { status: string; balance: number }, requested: number) =>
  balanceUnchanged(plan.balance, plan.status === 'Redeemed' ? 0 : requested)

/** Paystack has already accepted the transfer by now. False means a deposit landed; it must not be zeroed. */
export async function closePlanAfterFinalize(client: Client, planId: string, requestedBalance: number): Promise<boolean> {
  const closed = await client.savingsPlan.updateMany({
    where: {
      id: planId,
      OR: [
        { status: 'Redeemed', balance: near(0) },
        { status: { not: 'Redeemed' }, balance: near(requestedBalance) },
      ],
    },
    data: { status: 'Redeemed', balance: 0 },
  })
  return closed.count === 1
}

/** Thrown inside a saving's transaction to undo its debit when the plan closed after it was loaded. */
export class PlanClosedError extends Error {}

/** Credit a saving only if the plan is still open. Run inside the transaction that debits the agent. */
export async function creditOpenPlan(client: Client, planId: string, amount: number): Promise<void> {
  const credited = await client.savingsPlan.updateMany({
    where: { id: planId, status: { not: 'Redeemed' } },
    data: { balance: { increment: amount } },
  })
  if (credited.count !== 1) throw new PlanClosedError()
}

const OPEN_STATUSES = IN_FLIGHT_REDEMPTION_STATUSES.filter(s => s !== 'Approved')

/**
 * Whether new money should be refused because a redemption is in progress. Nothing ever expires a
 * Pending request, so one whose code ran out unused doesn't count: it would stop this customer saving
 * until an admin noticed. If an admin approves it anyway, the balance check above still blocks it.
 */
export async function hasOpenRedemption(client: Client, planId: string, now = new Date()): Promise<boolean> {
  const open = await client.earlyRedemption.findFirst({
    where: {
      savingsPlanId: planId,
      OR: [
        { status: { in: OPEN_STATUSES.filter(s => s !== 'Pending') } },
        { status: 'Pending', tokenExpiry: null },
        { status: 'Pending', tokenExpiry: { gte: now } },
      ],
    },
    select: { id: true },
  })
  return open !== null
}
