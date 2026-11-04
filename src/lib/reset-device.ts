import type { PrismaClient } from '@prisma/client'

/**
 * Frees a customer from the phone their account is locked to, so they can sign in on a new one (the next sign-in binds again).
 * The old phone is signed out and its fingerprint sign-in revoked in the same step, because the usual reason is a lost or replaced
 * phone. Used by the admin screen and by the agent who owns the customer. Returns how many fingerprint sign-ins were revoked.
 */
export async function resetCustomerDevice(db: Pick<PrismaClient, '$transaction'>, customerId: string): Promise<number> {
  return db.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: customerId }, data: { boundDeviceId: null, tokenVersion: { increment: 1 } } })
    const tokens = await tx.biometricToken.updateMany({ where: { customerId, revokedAt: null }, data: { revokedAt: new Date() } })
    return tokens.count
  })
}
