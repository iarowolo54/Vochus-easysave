import type { PrismaClient } from '@prisma/client'
import { accruedInterest } from './savings-interest'
import { getSavingsRateSchedule } from './savings-interest-rate'

type PlanClient = Pick<PrismaClient, 'transaction' | 'savingsInterestRate'>

/**
 * Interest accrued on a plan. Only self-service plans earn interest; offline/agent
 * plans return 0 without touching the DB. Reads only amount + createdAt of the
 * plan's completed `saving` deposits.
 */
export async function accruedInterestForPlan(
  client: PlanClient,
  plan: { id: string; source: string; startDate: Date; maturityDate: Date },
  asOf: Date,
): Promise<number> {
  if (plan.source !== 'self') return 0
  const [deposits, rateSchedule] = await Promise.all([
    client.transaction.findMany({
      where: { planId: plan.id, type: 'saving', status: 'Done' },
      select: { amount: true, createdAt: true },
    }),
    getSavingsRateSchedule(client),
  ])
  return accruedInterest({ startDate: plan.startDate, maturityDate: plan.maturityDate, deposits, asOf, rateSchedule })
}
