// Roll over a plan that has ended but not been redeemed, so the customer can keep saving into it.
// It stays the same plan: same id, start date, fee record, history and interest earned so far. Only the end date moves.
// A redeemed plan is closed for good: the customer starts a new plan instead.
// One conditional update, so two taps (or a payout landing at the same time) can't both win.
import type { Prisma, PrismaClient } from '@prisma/client'
import { hasOpenRedemption } from '@/lib/redemption-balance'
import { maturityFrom } from '@/lib/saving-plan'

type Client = Pick<PrismaClient, 'savingsPlan' | 'earlyRedemption'> | Prisma.TransactionClient

export const REOPEN_COLLECTING = 'A redemption has been requested on this plan. Wait for it to finish before saving into it again.'
export const REOPEN_NOT_FINISHED = 'This plan is still running, so you can keep saving into it.'
export const REOPEN_NOT_FOUND = 'Plan not found'
export const REOPEN_REDEEMED = 'This plan has been redeemed, so it can’t be saved into again. Start a new plan instead.'

export type ReopenResult = { ok: true; planId: string } | { ok: false; reason: ReopenFailure }
export type ReopenFailure = 'not_found' | 'not_finished' | 'collecting' | 'redeemed'

export async function reopenPlan(client: Client, input: { planId: string; customerId: string }, now: Date = new Date()): Promise<ReopenResult> {
  const plan = await client.savingsPlan.findFirst({
    where: { id: input.planId, customerId: input.customerId },
    select: { id: true, status: true, periodDays: true, cadence: true },
  })
  // An Ajo payout plan holds a group's pot to collect; it is never saved into again.
  if (!plan || plan.cadence === 'ajo') return { ok: false, reason: 'not_found' }
  if (plan.status === 'Redeemed') return { ok: false, reason: 'redeemed' }
  if (await hasOpenRedemption(client, plan.id, now)) return { ok: false, reason: 'collecting' }

  const maturityDate = maturityFrom(now, plan.periodDays)
  const moved =
    plan.status === 'Active'
        ? await client.savingsPlan.updateMany({
            where: { id: plan.id, customerId: input.customerId, status: 'Active', maturityDate: { lte: now } },
            data: { maturityDate, maturityNotified: false },
          })
        : { count: 0 }
  return moved.count === 1 ? { ok: true, planId: plan.id } : { ok: false, reason: 'not_finished' }
}

/** Whether this plan could be reopened right now, without changing it. Checked before a code is sent. */
export async function checkReopenable(client: Client, input: { planId: string; customerId: string }, now: Date = new Date()): Promise<ReopenResult> {
  const plan = await client.savingsPlan.findFirst({
    where: { id: input.planId, customerId: input.customerId },
    select: { id: true, status: true, maturityDate: true, cadence: true },
  })
  if (!plan || plan.cadence === 'ajo') return { ok: false, reason: 'not_found' }
  if (plan.status === 'Redeemed') return { ok: false, reason: 'redeemed' }
  if (await hasOpenRedemption(client, plan.id, now)) return { ok: false, reason: 'collecting' }
  const finished = plan.status === 'Active' && plan.maturityDate <= now
  return finished ? { ok: true, planId: plan.id } : { ok: false, reason: 'not_finished' }
}
