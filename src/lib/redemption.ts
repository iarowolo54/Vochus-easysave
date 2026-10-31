// Ownership + atomic-claim logic for agent-initiated plan redemption.
//
// Finding #1: the redemption route loaded a plan by { id, customerId } straight
// from the request body — with no link to the acting agent — then credited that
// agent, so any agent could drain any other agent's customer. These helpers scope
// the lookup to the agent's OWN customers and make the redeem a single-use atomic
// claim so concurrent calls can't double-spend.
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { IN_FLIGHT_REDEMPTION_STATUSES } from './redemption-statuses'

export { IN_FLIGHT_REDEMPTION_STATUSES }

/** The plan only if it belongs to one of this agent's customers and is still
 *  redeemable (positive balance, not already redeemed, not an online plan). Null otherwise → 404. */
export function loadOwnedRedeemablePlan(agentDbId: string, customerId: string, planId: string) {
  return prisma.savingsPlan.findFirst({
    where: {
      id: planId,
      customerId,
      balance: { gt: 0 },
      status: { not: 'Redeemed' },
      // Online (self) plans redeem ONLY via the customer-OTP + admin-approval pipeline;
      // the agent-direct path would bypass that approval (SR-4).
      source: { not: 'self' },
      customer: { agentId: agentDbId },
      // Mutual exclusion with the customer early-redemption pipeline: a plan with
      // an in-flight EarlyRedemption must not also be redeemed via the agent path.
      earlyRedemptions: {
        none: { status: { in: IN_FLIGHT_REDEMPTION_STATUSES } },
      },
    },
  })
}

/** Atomically redeem the plan (zero balance, mark Redeemed) ONLY if it is still
 *  redeemable. Returns true iff this call won the claim; a losing concurrent call
 *  gets false and must not credit. Run inside the crediting transaction (pass the
 *  tx client) so claim + credit commit together. */
export async function claimPlanForRedemption(
  client: Prisma.TransactionClient | typeof prisma,
  planId: string,
  expectedBalance: number,
): Promise<boolean> {
  // Match the EXACT balance the payout was computed from, so a concurrent change
  // (e.g. a deposit) since the plan was loaded makes this claim fail rather than
  // pay out a stale amount. The caller then retries with a fresh balance.
  const res = await client.savingsPlan.updateMany({
    where: { id: planId, balance: expectedBalance, status: { not: 'Redeemed' } },
    data: { balance: 0, status: 'Redeemed' },
  })
  return res.count === 1
}
