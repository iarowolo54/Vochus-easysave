import { Prisma, type PrismaClient, type EarlyRedemption } from '@prisma/client'
import { randomInt } from 'node:crypto'
import { hashRedemptionToken } from './redemption-token'

type Client = Prisma.TransactionClient | Pick<PrismaClient, 'earlyRedemption'>

// Create an EarlyRedemption with a 6-digit confirmation code whose hash is unique.
// `EarlyRedemption.token` is @unique, but both creation paths draw a random code
// and store its hash — two pending redemptions drawing the same code would collide
// and 500. This retries ONLY on a token-unique violation (regenerating the code),
// and rethrows anything else (e.g. a duplicate `ref`) immediately so real errors
// aren't masked. `buildData` receives the hashed token and returns the full create
// input; the plaintext `code` is returned for out-of-band (SMS/email) delivery.
// `genCode` is injectable for tests.
export async function createRedemptionWithUniqueCode(
  client: Client,
  buildData: (tokenHash: string) => Prisma.EarlyRedemptionUncheckedCreateInput,
  genCode: () => string = () => randomInt(100000, 1000000).toString(),
  maxTries = 8,
): Promise<{ redemption: EarlyRedemption; code: string }> {
  let lastErr: unknown
  for (let i = 0; i < maxTries; i++) {
    const code = genCode()
    try {
      const redemption = await client.earlyRedemption.create({ data: buildData(hashRedemptionToken(code)) })
      return { redemption, code }
    } catch (e) {
      const isTokenCollision =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        String((e.meta as { target?: unknown } | undefined)?.target ?? '').includes('token')
      if (!isTokenCollision) throw e
      lastErr = e
    }
  }
  // Reaching here means every attempt hit a token collision (non-token errors
  // rethrow above), which is astronomically unlikely for a 6-digit space.
  throw new Error(`could not create redemption with a unique confirmation code after ${maxTries} attempts`, { cause: lastErr })
}
