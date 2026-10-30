import type { Prisma, PrismaClient } from '@prisma/client'

// Max wrong confirmation-code attempts per redemption before token verification
// is locked. The code is 6 digits (~900k values) and expires in 30 minutes; a
// low cap makes brute force infeasible for a session-hijacker (customer PATCH
// path) or a rogue agent (agent verify-token path) while leaving room for the
// genuine owner's typos.
export const REDEMPTION_ATTEMPT_LIMIT = 5

type Client = Prisma.TransactionClient | Pick<PrismaClient, 'earlyRedemption'>

// Atomically reserve ONE token-verification attempt against a Pending redemption,
// BEFORE comparing the submitted code. Returns true if an attempt was reserved
// (the caller may compare the code), false if the record is not Pending or the
// attempt cap is already reached. The conditional updateMany closes the TOCTOU
// where concurrent wrong guesses would otherwise all read the same count and
// slip past the cap.
export async function reserveRedemptionAttempt(client: Client, ref: string): Promise<boolean> {
  const reserved = await client.earlyRedemption.updateMany({
    where: { ref, status: 'Pending', attempts: { lt: REDEMPTION_ATTEMPT_LIMIT } },
    data: { attempts: { increment: 1 } },
  })
  return reserved.count > 0
}
