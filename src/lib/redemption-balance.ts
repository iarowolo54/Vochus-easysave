// A redemption's payout was worked out from the balance at request time. Paying it after the balance
// has changed, then zeroing the plan, wipes whatever arrived in between. So every path that closes a
// plan for a redemption goes through here, and a changed balance blocks it (no recalculation).
import type { Prisma, PrismaClient } from '@prisma/client'
import { logAudit } from './audit'
import { prisma } from './prisma'
import { notifySuperAdminsRedemptionPending } from './redemption-notify'
import { heldForNameCheck } from './payout-account'
import { money } from './wallet-guard'
import { excludeExpiredPending, IN_FLIGHT_REDEMPTION_STATUSES } from './redemption-statuses'

type Client = Pick<PrismaClient, 'savingsPlan' | 'earlyRedemption'> | Prisma.TransactionClient

export const SAVING_BLOCKED = 'This customer has asked to collect from this plan, so new savings can’t be recorded yet. Wait for the office to decide, or ask an admin to reject the request.'
export const PLAN_CLOSED = 'This plan has been closed, so nothing was recorded and your wallet wasn’t charged.'
export const AGENT_NOT_ACTIVE = 'This agent’s account isn’t active, so this withdrawal can’t be paid. You can reject it, which returns the money to their commission.'
export const CASH_NEEDS_ACTIVE_AGENT = 'This customer’s agent isn’t active, so cash can’t be paid through them. Reject this request and ask the customer to request again with a bank account.'
export const BALANCE_CHANGED = 'This customer’s balance has changed since they asked to collect. Reject this request and ask them to request again.'
export const BALANCE_CHANGED_AWAITING_OTP = 'This customer’s balance has changed while this payout was waiting for its code. Nothing has been paid. Don’t enter the code. Once it expires, about 30 minutes after it was sent, use Check with Paystack and ask them to request again.'

// Some requests store money(plan.balance), which can differ from the stored float by half a kobo.
// The smallest real deposit is a whole kobo, so this can't hide one.
const TOLERANCE = 0.006
const near = (amount: number) => ({ gte: amount - TOLERANCE, lte: amount + TOLERANCE })

// From Paystack's "How Transfers Work": failed and reversed were not processed or were returned, and abandoned
// (no OTP within 30 minutes) will not be processed. Blocked and rejected are final too, but the page doesn't
// say whether money moved, so they are flagged for a person rather than released.
export const NO_MONEY_LEFT = ['failed', 'reversed', 'abandoned']
// What approve books straight away. Pending is kept there because that's how live bank payouts come back today, and
// nothing would otherwise close them: the live webhook ignores transfer events and Processing would wait for an admin
// on every payout. Finalize and verify book only success, since an admin is already there to check again. Once the
// webhook task reports real outcomes, approve should stop booking pending too.
export const TRANSFER_ACCEPTED = ['success', 'pending']

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

/** Paystack has already accepted the transfer by now. False means a deposit landed: it must not be zeroed, and
 *  the payout still has to be recorded, so the caller leaves it on the plan and flags it for review. */
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

/**
 * Reopen a plan after its pre-claim, when no money left. Adds the balance back rather than setting
 * it, because a deposit may have landed on the closed plan. Approval then refuses, correctly, if one did.
 */
export async function reopenPlanAfterNoTransfer(client: Client, planId: string, balance: number, status: string): Promise<void> {
  const reopened = await client.savingsPlan.updateMany({
    where: { id: planId, status: 'Redeemed' },
    data: { status, balance: { increment: balance } },
  })
  if (reopened.count === 1) return
  // An older record that reached AwaitingOTP without a pre-claim: its plan was never closed, so there's nothing to add.
  const plan = await client.savingsPlan.findUnique({ where: { id: planId }, select: { id: true } })
  if (!plan) throw new Error('Plan not found')
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

/**
 * An agent checked the customer's code in person, so the request has been confirmed and goes to the admin:
 * recorded, audited and announced the same way as an agent approving a request the customer confirmed.
 * False if it had already moved on or the code ran out in the meantime.
 */
export async function confirmRequestWithCode(
  record: { id: string; ref: string; netPayout: number; payoutMethod: string | null; accountName: string | null; savingsPlan: { goal: string; customer: { firstName: string; lastName: string } } },
  agent: { id: string; agentId: string; name: string },
  now = new Date(),
): Promise<boolean> {
  const moved = await prisma.earlyRedemption.updateMany({
    where: { id: record.id, status: 'Pending', tokenExpiry: { gte: now } },
    data: { status: 'AgentApproved', agentApprovedAt: now, agentApprovedBy: agent.agentId },
  })
  if (moved.count !== 1) return false
  const customerName = `${record.savingsPlan.customer.firstName} ${record.savingsPlan.customer.lastName}`
  logAudit({
    action: 'agent_redemption_code_confirmed',
    entity: 'EarlyRedemption',
    entityId: record.id,
    details: `Agent ${agent.name} (${agent.agentId}) confirmed the code for redemption ${record.ref} for ${customerName} — sent to admin`,
    actorType: 'agent',
    actorId: agent.id,
    actorName: agent.name,
  })
  // Fire-and-forget; never throws.
  const warning = heldForNameCheck(record, record.savingsPlan.customer) ? `Held: the payout account is in the name ${record.accountName}, not ${customerName}. Compare the names before approving.` : undefined
  notifySuperAdminsRedemptionPending(prisma, { customerName, amountNaira: record.netPayout, planGoal: record.savingsPlan.goal, ref: record.ref, warning }).catch(() => {})
  return true
}

/**
 * Paystack has paid, so close the plan, in the same transaction as the ledger. A deposit that landed during the
 * payout must not be zeroed: it stays on the plan and is flagged. True means someone needs to look at it.
 */
export async function settlePlanAfterPayout(tx: Prisma.TransactionClient, record: { id: string; ref: string; savingsPlanId: string; balance: number }): Promise<boolean> {
  if (await closePlanAfterFinalize(tx, record.savingsPlanId, record.balance)) return false
  // A closed plan's balance is all new money. An open plan (no pre-claim) still holds what was just paid.
  const current = await tx.savingsPlan.findUniqueOrThrow({ where: { id: record.savingsPlanId }, select: { status: true, balance: true } })
  const deposit = current.status === 'Redeemed' ? current.balance : Math.max(0, money(current.balance - record.balance))
  await tx.savingsPlan.update({ where: { id: record.savingsPlanId }, data: { status: 'Redeemed', balance: deposit } })
  await tx.auditLog.create({
    data: {
      action: 'early_redemption_review_needed',
      entity: 'EarlyRedemption',
      entityId: record.id,
      details: `MANUAL REVIEW: ${record.ref} was paid by Paystack, but plan ${record.savingsPlanId} holds ₦${deposit.toLocaleString()} that arrived during the payout. It was left on the closed plan.`,
      actorType: 'system',
      actorName: 'Early redemption payout',
    },
  })
  return true
}

const OPEN_STATUSES = IN_FLIGHT_REDEMPTION_STATUSES.filter(s => s !== 'Approved')

/** Whether new money should be refused because a redemption is in progress. If an abandoned request is
 *  approved anyway after money arrives, the balance check above still blocks it. */
export async function hasOpenRedemption(client: Client, planId: string, now = new Date()): Promise<boolean> {
  const open = await client.earlyRedemption.findFirst({
    where: { savingsPlanId: planId, status: { in: OPEN_STATUSES }, ...excludeExpiredPending(now) },
    select: { id: true },
  })
  return open !== null
}
