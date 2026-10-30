// Shared savings-plan helpers.
//
// resolvePlanStartDate (#6): customers' plan routes used to always start "today".
// They now accept an optional "yyyy-mm-dd" start date (today or later), the same
// way the agent route /api/customers/plan already does.
//
// selectActivePlan (#7): routes that add money to a plan used to pick "the newest
// Active plan by start date", so for a customer with several plans every saving
// landed on the wrong one. They now take an explicit planId (checked to belong to
// the customer and be Active); with no planId it only works when there is exactly
// one Active plan, otherwise the caller must disambiguate.
import type { Prisma, PrismaClient } from '@prisma/client'

export type StartDateResult = { date: Date } | { error: string }

const YMD = /^\d{4}-\d{2}-\d{2}$/

export function resolvePlanStartDate(input: unknown, now: Date = new Date()): StartDateResult {
  if (input === undefined || input === null || input === '') return { date: new Date(now) }
  if (typeof input !== 'string' || !YMD.test(input)) {
    return { error: 'Start date must be in yyyy-mm-dd format' }
  }
  const [y, m, d] = input.split('-').map(Number)
  const date = new Date(y, m - 1, d) // local midnight
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return { error: 'Start date is not a real date' }
  }
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (date.getTime() < todayMidnight.getTime()) {
    return { error: 'Start date must be today or later' }
  }
  return { date }
}

export function maturityFrom(start: Date, periodDays: number): Date {
  const m = new Date(start)
  m.setDate(m.getDate() + periodDays)
  return m
}

export type PlanSelection =
  | { plan: { id: string; source: string } }
  | { error: 'none' | 'not_found' | 'ambiguous' }

// Resolves which Active plan a saving should go to, scoped to the customer.
export async function selectActivePlan(
  client: Pick<PrismaClient, 'savingsPlan'> | Prisma.TransactionClient,
  customerId: string,
  planId?: string | null,
): Promise<PlanSelection> {
  if (planId) {
    const plan = await client.savingsPlan.findFirst({
      where: { id: planId, customerId, status: 'Active' },
      select: { id: true, source: true },
    })
    return plan ? { plan } : { error: 'not_found' }
  }
  const active = await client.savingsPlan.findMany({
    where: { customerId, status: 'Active' },
    select: { id: true, source: true },
    take: 2,
  })
  if (active.length === 0) return { error: 'none' }
  if (active.length > 1) return { error: 'ambiguous' }
  return { plan: active[0] }
}

// SR-3: interest accrues from each deposit's createdAt, so on an ONLINE
// (source:'self') plan a client-supplied date must never backdate a deposit.
// Returns undefined (=> createdAt defaults to now) for self plans; offline
// (agent) plans keep honoring the date (they earn no interest).
export function depositCreatedAt(planSource: string, clientDate?: string | Date | null): Date | undefined {
  if (planSource === 'self') return undefined
  return clientDate ? new Date(clientDate) : undefined
}
