import type { Prisma, PrismaClient } from '@prisma/client'

// Max wrong confirmation-code attempts per redemption before token verification
// is locked. The code is 6 digits (~900k values) and expires in 30 minutes; a
// low cap makes brute force infeasible for a session-hijacker (customer PATCH
// path) or a rogue agent (agent verify-token path) while leaving room for the
// genuine owner's typos.
export const REDEMPTION_ATTEMPT_LIMIT = 5

// Lookups by code alone, per agent per hour. A wrong guess matches no record, so it can't be capped per
// redemption like the attempts above. Over a million codes this makes guessing one impractical.
export const CODE_LOOKUPS_PER_HOUR = 20
const HOUR_MS = 60 * 60 * 1000

/**
 * Spends one code lookup for this agent, in the database so it holds across both instances. Uses LoginAttempt
 * rows under their own key prefix; the window end is in lockedUntil, which also keeps the login sweep off a
 * live window. `firstRefusal` is true once per window, so a burst of guesses raises one alert, not hundreds.
 */
export async function spendCodeLookup(
  client: Pick<PrismaClient, 'loginAttempt'>,
  agentDbId: string,
  now = new Date(),
): Promise<{ allowed: boolean; firstRefusal: boolean }> {
  const key = `redeem-lookup:agent:${agentDbId}`
  const windowEnd = new Date(now.getTime() + HOUR_MS)
  // Losing a create race is fine, the row exists. Any other failure shows up as no row below: refused.
  await client.loginAttempt.upsert({ where: { key }, create: { key, failCount: 0, lockedUntil: windowEnd }, update: {} }).catch(() => {})
  await client.loginAttempt.updateMany({ where: { key, lockedUntil: { lt: now } }, data: { failCount: 0, lockedUntil: windowEnd } })
  const spent = await client.loginAttempt.updateMany({ where: { key, failCount: { lt: CODE_LOOKUPS_PER_HOUR } }, data: { failCount: { increment: 1 } } })
  if (spent.count === 1) return { allowed: true, firstRefusal: false }
  const flagged = await client.loginAttempt.updateMany({ where: { key, failCount: CODE_LOOKUPS_PER_HOUR }, data: { failCount: { increment: 1 } } })
  return { allowed: false, firstRefusal: flagged.count === 1 }
}

type Client = Prisma.TransactionClient | Pick<PrismaClient, 'earlyRedemption'>

// Atomically reserve ONE token-verification attempt against a Pending redemption,
// BEFORE comparing the submitted code. Returns true if an attempt was reserved
// (the caller may compare the code), false if the record is not Pending or the
// attempt cap is already reached. The conditional updateMany closes the TOCTOU
// where concurrent wrong guesses would otherwise all read the same count and
// slip past the cap.
export async function reserveRedemptionAttempt(client: Client, ref: string): Promise<boolean> {
  // notify: none — counts wrong code guesses (a security limit), not a change the customer needs to hear about
  const reserved = await client.earlyRedemption.updateMany({
    where: { ref, status: 'Pending', attempts: { lt: REDEMPTION_ATTEMPT_LIMIT } },
    data: { attempts: { increment: 1 } },
  })
  return reserved.count > 0
}
