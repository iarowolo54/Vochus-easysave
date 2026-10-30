// Savings interest-rate store: an append-only, effective-dated schedule.
import type { PrismaClient } from '@prisma/client'
import { rateOn, type RateEntry } from './savings-interest'

type Client = Pick<PrismaClient, 'savingsInterestRate'>

export async function getSavingsRateSchedule(client: Client): Promise<RateEntry[]> {
  const rows = await client.savingsInterestRate.findMany({
    orderBy: { effectiveFrom: 'asc' },
    select: { effectiveFrom: true, annualRate: true },
  })
  return rows.map((r) => ({ effectiveFrom: r.effectiveFrom, annualRate: r.annualRate }))
}

export async function getCurrentSavingsRate(client: Client): Promise<number> {
  return rateOn(await getSavingsRateSchedule(client), new Date())
}

export async function appendSavingsRate(
  client: Client,
  annualRate: number,
  createdBy?: string,
): Promise<void> {
  if (typeof annualRate !== 'number' || !Number.isFinite(annualRate) || annualRate < 0) {
    throw new Error('annualRate must be a finite number >= 0')
  }
  await client.savingsInterestRate.create({
    data: { annualRate, effectiveFrom: new Date(), createdBy },
  })
}
