// Reopen a finished plan so the customer can save into it again.
// It stays the same plan: same id, start date, fee record and history. Only the end date moves so deposits are accepted.
//  - Redeemed (collected): back to Active. Interest counts only deposits from now on (cycleStartedAt), because the
//    earlier deposits' interest was already paid out at collection.
//  - Matured but not collected: the money is still on the plan, so the interest earned so far is kept.
// Both are one conditional update, so two taps (or a payout landing at the same time) can't both win.
import type { Prisma, PrismaClient } from '@prisma/client'
import { hasOpenRedemption } from '@/lib/redemption-balance'
import { maturityFrom } from '@/lib/saving-plan'

type Client = Pick<PrismaClient, 'savingsPlan' | 'earlyRedemption'> | Prisma.TransactionClient

export const REOPEN_COLLECTING = 'A redemption has been requested on this plan. Wait for it to finish before saving into it again.'
export const REOPEN_NOT_FINISHED = 'This plan is still running, so you can keep saving into it.'
export const REOPEN_NOT_FOUND = 'Plan not found'

export type ReopenResult = { ok: true; planId: string } | { ok: false; reason: 'not_found' | 'not_finished' | 'collecting' }

export async function reopenPlan(client: Client, input: { planId: string; customerId: string }, now: Date = new Date()): Promise<ReopenResult> {
  const plan = await client.savingsPlan.findFirst({
    where: { id: input.planId, customerId: input.customerId },
    select: { id: true, status: true, periodDays: true },
  })
  if (!plan) return { ok: false, reason: 'not_found' }
  if (await hasOpenRedemption(client, plan.id, now)) return { ok: false, reason: 'collecting' }

  const maturityDate = maturityFrom(now, plan.periodDays)
  const moved =
    plan.status === 'Redeemed'
      ? await client.savingsPlan.updateMany({
          where: { id: plan.id, customerId: input.customerId, status: 'Redeemed' },
          data: { status: 'Active', maturityDate, maturityNotified: false, interestAccrued: 0, cycleStartedAt: now },
        })
      : plan.status === 'Active'
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
    select: { id: true, status: true, maturityDate: true },
  })
  if (!plan) return { ok: false, reason: 'not_found' }
  if (await hasOpenRedemption(client, plan.id, now)) return { ok: false, reason: 'collecting' }
  const finished = plan.status === 'Redeemed' || (plan.status === 'Active' && plan.maturityDate <= now)
  return finished ? { ok: true, planId: plan.id } : { ok: false, reason: 'not_finished' }
}
