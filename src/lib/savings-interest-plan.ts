import type { PrismaClient } from '@prisma/client'
import { accruedInterest, interestProjection, type InterestProjection } from './savings-interest'
import { getSavingsRateSchedule } from './savings-interest-rate'

type PlanClient = Pick<PrismaClient, 'transaction' | 'savingsInterestRate'>

/**
 * Interest accrued on a plan. Only self-service plans earn interest; offline/agent
 * plans return 0 without touching the DB. Reads only amount + createdAt of the
 * plan's completed `saving` deposits.
 */
export async function accruedInterestForPlan(
  client: PlanClient,
  plan: { id: string; source: string; startDate: Date; maturityDate: Date; cycleStartedAt?: Date | null },
  asOf: Date,
): Promise<number> {
  if (plan.source !== 'self') return 0
  const [deposits, rateSchedule] = await Promise.all([
    client.transaction.findMany({
      where: { planId: plan.id, type: 'saving', status: 'Done', ...(plan.cycleStartedAt ? { createdAt: { gte: plan.cycleStartedAt } } : {}) },
      select: { amount: true, createdAt: true },
    }),
    getSavingsRateSchedule(client),
  ])
  return accruedInterest({ startDate: plan.startDate, maturityDate: plan.maturityDate, deposits, asOf, rateSchedule })
}

/**
 * The next-credit nudge for a plan. Only self-service plans project interest; offline/agent
 * plans return null without touching the DB. Reads only the effective-dated rate schedule.
 */
export async function interestProjectionForPlan(
  client: PlanClient,
  plan: { source: string; startDate: Date; maturityDate: Date; balance: number },
  asOf: Date,
): Promise<InterestProjection | null> {
  if (plan.source !== 'self') return null
  const rateSchedule = await getSavingsRateSchedule(client)
  return interestProjection({
    startDate: plan.startDate,
    maturityDate: plan.maturityDate,
    balance: plan.balance,
    asOf,
    rateSchedule,
  })
}
