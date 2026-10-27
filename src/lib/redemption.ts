// Ownership + atomic-claim logic for agent-initiated plan redemption.
//
// Finding #1: the redemption route loaded a plan by { id, customerId } straight
// from the request body — with no link to the acting agent — then credited that
// agent, so any agent could drain any other agent's customer. These helpers scope
// the lookup to the agent's OWN customers and make the redeem a single-use atomic
// claim so concurrent calls can't double-spend.
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'

/** The plan only if it belongs to one of this agent's customers and is still
 *  redeemable (positive balance, not already redeemed). Null otherwise → 404. */
export function loadOwnedRedeemablePlan(agentDbId: string, customerId: string, planId: string) {
  return prisma.savingsPlan.findFirst({
    where: {
      id: planId,
      customerId,
      balance: { gt: 0 },
      status: { not: 'Redeemed' },
      customer: { agentId: agentDbId },
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
): Promise<boolean> {
  const res = await client.savingsPlan.updateMany({
    where: { id: planId, balance: { gt: 0 }, status: { not: 'Redeemed' } },
    data: { balance: 0, status: 'Redeemed' },
  })
  return res.count === 1
}
