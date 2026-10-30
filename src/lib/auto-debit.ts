import type { AutoDebitMandate, PrismaClient, SavingsPlan } from '@prisma/client'
import { autoDebitCadence, nextRunAt } from '@/lib/auto-debit-schedule'
import type { PaystackAuthorization } from '@/lib/paystack'

type Client = Pick<PrismaClient, 'autoDebitMandate' | 'savingsPlan'>

export type MandateWithPlan = AutoDebitMandate & { savingsPlan: SavingsPlan }

export type CreateMandateResult = { id: string } | { error: 'not_self' | 'not_reusable' | 'exists' }

/**
 * Persist a mandate from a verified Paystack card authorization. Stores the
 * reusable authorization_code (a secret: never log it) plus masked display
 * fields only; no PAN/CVV/PIN ever reaches this layer.
 */
export async function createMandateFromAuthorization(
  client: Client,
  input: {
    customerId: string
    plan: { id: string; source: string; cadence: string; dailyAmount: number }
    email: string
    authorization: PaystackAuthorization
  },
): Promise<CreateMandateResult> {
  const { plan, authorization } = input
  if (plan.source !== 'self') return { error: 'not_self' }
  if (!authorization.reusable) return { error: 'not_reusable' }

  const existing = await client.autoDebitMandate.findUnique({ where: { savingsPlanId: plan.id }, select: { id: true } })
  if (existing) return { error: 'exists' }

  const now = new Date()
  try {
    const m = await client.autoDebitMandate.create({
      data: {
        customerId: input.customerId,
        savingsPlanId: plan.id,
        channel: 'card',
        authorizationCode: authorization.authorization_code,
        authSignature: authorization.signature,
        authEmail: input.email,
        reusable: true,
        last4: authorization.last4 ?? null,
        cardType: authorization.card_type ?? null,
        bankName: authorization.bank ?? null,
        expMonth: authorization.exp_month ?? null,
        expYear: authorization.exp_year ?? null,
        status: 'active',
        amountPerCycle: plan.dailyAmount,
        nextRunAt: nextRunAt(now, autoDebitCadence(plan.cadence)),
        consentAt: now,
      },
      select: { id: true },
    })
    return { id: m.id }
  } catch (e) {
    // Lost a race on the unique savingsPlanId.
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002') return { error: 'exists' }
    throw e
  }
}

/** Active mandates whose run time has come, on still-Active plans that have not matured. */
export async function dueMandates(client: Client, now: Date): Promise<MandateWithPlan[]> {
  const mandates = await client.autoDebitMandate.findMany({
    where: { status: 'active', nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
  })
  if (mandates.length === 0) return []
  const plans = await client.savingsPlan.findMany({
    where: { id: { in: mandates.map((m) => m.savingsPlanId) }, status: 'Active', maturityDate: { gt: now } },
  })
  const byId = new Map(plans.map((p) => [p.id, p]))
  const out: MandateWithPlan[] = []
  for (const m of mandates) {
    const savingsPlan = byId.get(m.savingsPlanId)
    if (savingsPlan) out.push({ ...m, savingsPlan })
  }
  return out
}

export async function pauseMandate(client: Client, mandateId: string): Promise<void> {
  await client.autoDebitMandate.update({ where: { id: mandateId }, data: { status: 'paused' } })
}

/** Marks the mandate cancelled. The Paystack authorization deactivate call is the route's job. */
export async function cancelMandate(client: Client, mandateId: string): Promise<void> {
  await client.autoDebitMandate.update({ where: { id: mandateId }, data: { status: 'cancelled' } })
}
