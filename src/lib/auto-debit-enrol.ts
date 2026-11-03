// An auto-funding signup is one card charge that must end in a credited plan AND a mandate, whichever of the
// webhook and the customer's verify callback settles it first. The credit side is already shared; this is the
// mandate side, so the webhook winning the race no longer leaves the money saved with no mandate.
import type { PrismaClient } from '@prisma/client'
import { createMandateFromAuthorization } from '@/lib/auto-debit'
import type { PaystackAuthorization } from '@/lib/paystack'

export const isEnrolmentRef = (reference: string) => reference.startsWith('addenroll-')

export type EnrolmentMandateResult = 'created' | 'exists' | 'no-credit' | 'not-reusable' | 'not-self'

/**
 * Creates the mandate for an enrolment charge that has already been credited. It only ever creates: if the
 * plan has any mandate row, including one the customer has since cancelled, a replay of the same signup must
 * not bring it back.
 */
export async function ensureEnrolmentMandate(
  client: PrismaClient,
  reference: string,
  authorization: PaystackAuthorization | undefined,
): Promise<EnrolmentMandateResult> {
  const credit = await client.transaction.findUnique({ where: { ref: reference }, select: { customerId: true, planId: true } })
  if (!credit?.customerId || !credit.planId) return 'no-credit'
  if (!authorization?.reusable) return 'not-reusable'

  const existing = await client.autoDebitMandate.findUnique({ where: { savingsPlanId: credit.planId }, select: { id: true } })
  if (existing) return 'exists'

  const [customer, plan] = await Promise.all([
    client.customer.findUnique({ where: { id: credit.customerId } }),
    client.savingsPlan.findFirst({ where: { id: credit.planId, customerId: credit.customerId, source: 'self' } }),
  ])
  if (!customer || !plan) return 'not-self'

  try {
    const made = await createMandateFromAuthorization(client, {
      customerId: customer.id,
      plan: { id: plan.id, source: plan.source, cadence: plan.cadence, dailyAmount: plan.dailyAmount },
      email: customer.email ?? `${customer.customerId.toLowerCase()}@vochus.ng`,
      authorization,
    })
    if ('error' in made) return made.error === 'not_reusable' ? 'not-reusable' : 'not-self'
    return 'created'
  } catch (e: unknown) {
    // The other route created it between the check and here.
    if ((e as { code?: unknown } | null)?.code === 'P2002') return 'exists'
    throw e
  }
}
